import { createPublicClient, encodeFunctionData, http, defineChain, type Abi, type Address, type PublicClient, type Chain, type Transport } from "viem";
import type { ProviderReport } from "../../core/types.ts";

export interface Call { key: string; address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }
export interface CallResult { key: string; ok: boolean; value?: unknown; error?: string }
export interface Endpoint { label: string; transport: Transport; /** budget for one Multicall's aggregate calldata, bytes; 2,600 measured safe for Etherscan's URL-based proxy, default 24,576 for JSON-RPC nodes */ maxCalldata?: number }


export type EndpointConfig = string | { url: string; batch?: boolean };
/** Public JSON-RPC endpoint. Request batching (capped at 10, the smallest cap seen among public nodes) can be switched off per endpoint. */
export const httpEndpoint = (cfg: EndpointConfig): Endpoint => {
  const url = typeof cfg === "string" ? cfg : cfg.url;
  const batch = typeof cfg === "string" ? true : cfg.batch !== false;
  return { label: url, transport: http(url, { batch: batch ? { batchSize: 10, wait: 10 } : false, timeout: 20_000, retryCount: 0 }) };
};

/**
 * Reads chain state through one endpoint, with failover:
 *  - every read in a run is pinned to one block (latest minus a small margin) so results are internally consistent
 *  - reads are folded into Multicall3 aggregate3 calls (one eth_call per batch)
 *  - the first healthy endpoint serves the run; if it fails mid-run the reader fails over to the next endpoint at the same block
 *  - the two-method comparison the tool promises is chain state against the Morpho API, not node against node
 */
export class OnchainReader {
  readonly chainId: number;
  readonly labels: string[];
  private readonly clients: PublicClient[];
  private readonly maxCalldata: number[];
  private primaryIdx = 0;
  block = 0n;
  blockTimestamp?: number;
  calls = 0;
  disagreements: string[] = [];
  failovers: string[] = [];

  private readonly pinLag: bigint;

  constructor(chainId: number, name: string, endpoints: Endpoint[], multicall3: Address, opts: { pinLag?: number } = {}) {
    if (endpoints.length === 0) throw new Error(`no endpoints configured for chain ${chainId}`);
    this.chainId = chainId;
    this.pinLag = BigInt(opts.pinLag ?? 2);
    this.labels = endpoints.map((e) => e.label);
    const chain: Chain = defineChain({ id: chainId, name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [] } }, contracts: { multicall3: { address: multicall3 } } });
    this.clients = endpoints.map((e) => createPublicClient({ chain, transport: e.transport }));
    this.maxCalldata = endpoints.map((e) => e.maxCalldata ?? 24576);
  }

  get urls(): string[] { return this.labels; }
  get primaryLabel(): string { return this.labels[this.primaryIdx]; }

  /** Tries the current endpoint up to three times (a public node's refusal is often transient), then the next endpoints. */
  private async withFailover<T>(fn: (c: PublicClient, idx: number) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = this.primaryIdx; i < this.clients.length; i++) {
      for (let attempt = 0; attempt < (i === this.primaryIdx ? 3 : 1); attempt++) {
        try { const out = await fn(this.clients[i], i); if (i !== this.primaryIdx) { this.failovers.push(`${this.labels[this.primaryIdx]} -> ${this.labels[i]}`); this.primaryIdx = i; } return out; }
        catch (e) { lastErr = e; if (attempt < 2 && i === this.primaryIdx) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async pin(): Promise<void> {
    if (this.block !== 0n) return;
    await this.withFailover(async (c) => {
      const latest = await c.getBlockNumber();
      const block = latest > this.pinLag ? latest - this.pinLag : latest;
      const blk = await c.getBlock({ blockNumber: block });
      this.block = block; this.blockTimestamp = Number(blk.timestamp);
    });
  }

  async chainIdOfPrimary(): Promise<number> { return this.withFailover((c) => c.getChainId()); }

  async read(calls: Call[]): Promise<Record<string, CallResult>> {
    if (calls.length === 0) return {};
    await this.pin();
    const contracts = calls.map((c) => ({ address: c.address, abi: c.abi, functionName: c.functionName, args: c.args ?? [] }));
    // Chunk by the size of the aggregate3 calldata actually sent, not by the inner calldata viem's batchSize counts:
    // each call costs about 128 bytes of encoding plus its padded calldata, so 4-byte calls would otherwise be packed
    // 128 to a chunk and blow the URL limit of an HTTP-GET provider such as Etherscan.
    const chunk = (subset: typeof contracts, budget: number) => {
      const out: (typeof contracts)[] = [[]];
      let used = 0;
      for (const c of subset) {
        const bytes = (encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args } as Parameters<typeof encodeFunctionData>[0]).length - 2) / 2;
        const cost = 128 + Math.ceil(bytes / 32) * 32;
        if (used + cost > budget && out[out.length - 1].length > 0) { out.push([]); used = 0; }
        out[out.length - 1].push(c); used += cost;
      }
      return out;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mc = (subset: typeof contracts) => this.withFailover(async (c, idx) => (await Promise.all(chunk(subset, this.maxCalldata[idx]).map((part) => c.multicall({ contracts: part as any, allowFailure: true, blockNumber: this.block, batchSize: 0 })))).flat());
    const res = [...(await mc(contracts))];
    this.calls += calls.length;
    // a chunk that failed for a transport reason (refused, rate-limited, timed out) is not a revert: retry those calls once
    const transient = (e: unknown) => /HTTP request failed|rate limit|timed out|timeout|fetch|network|RPC error|unknown RPC|429|403|502|503/i.test(String((e as Error)?.message ?? e));
    const retry = res.map((r, i) => (r.status === "failure" && transient(r.error) ? i : -1)).filter((i) => i >= 0);
    if (retry.length > 0 && retry.length < calls.length + 1) {
      await new Promise((r) => setTimeout(r, 1500));
      const again = await mc(retry.map((i) => contracts[i]));
      retry.forEach((i, j) => { res[i] = again[j]; });
    }
    const out: Record<string, CallResult> = {};
    calls.forEach((c, i) => { const r = res[i]; out[c.key] = r.status === "success" ? { key: c.key, ok: true, value: r.result } : { key: c.key, ok: false, error: String(r.error?.message ?? r.error).slice(0, 160) }; });
    return out;
  }

  /** Kept for callers written against the two-node design; nothing is pending any more. */
  async finish(): Promise<void> { /* no concurrent work */ }

  async getCode(addresses: Address[]): Promise<Record<string, boolean>> {
    await this.pin();
    const uniq = [...new Set(addresses.map((a) => a.toLowerCase() as Address))];
    const codes = await this.withFailover((c) => Promise.all(uniq.map((a) => c.getCode({ address: a, blockNumber: this.block }))));
    const out: Record<string, boolean> = {};
    uniq.forEach((a, i) => (out[a] = !!codes[i] && codes[i] !== "0x"));
    return out;
  }

  report(): ProviderReport {
    return { chainId: this.chainId, block: Number(this.block), blockTimestamp: this.blockTimestamp, primary: this.primaryLabel, secondary: null, secondaryStatus: "not-configured", disagreements: [...this.disagreements, ...this.failovers.map((f) => `failover: ${f}`)], calls: this.calls };
  }
}
