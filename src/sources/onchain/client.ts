import { createPublicClient, http, defineChain, type Abi, type Address, type PublicClient, type Chain, type Transport } from "viem";
import type { ProviderReport } from "../../core/types.ts";

export interface Call { key: string; address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }
export interface CallResult { key: string; ok: boolean; value?: unknown; error?: string }
export interface Endpoint { label: string; transport: Transport }

const stringify = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms))]);
/** Hard bound on one secondary replay; a slow second provider must never stall a run. */
const SECONDARY_TIMEOUT_MS = 12_000;

export type EndpointConfig = string | { url: string; batch?: boolean };
/** Public JSON-RPC endpoint. Request batching (capped at 10, the smallest cap seen among public nodes) can be switched off per endpoint. */
export const httpEndpoint = (cfg: EndpointConfig): Endpoint => {
  const url = typeof cfg === "string" ? cfg : cfg.url;
  const batch = typeof cfg === "string" ? true : cfg.batch !== false;
  return { label: url, transport: http(url, { batch: batch ? { batchSize: 10, wait: 10 } : false, timeout: 20_000, retryCount: 0 }) };
};

/**
 * Reads chain state through a list of endpoints:
 *  - every read in a run is pinned to one block (latest minus two) so results are internally consistent
 *  - reads are folded into Multicall3 aggregate3 calls (one eth_call per batch)
 *  - the first healthy endpoint is the primary; the next one replays every batch at the same block and is compared byte for byte
 *  - if the primary fails mid-run the reader fails over to the next endpoint at the same block
 */
export class OnchainReader {
  readonly chainId: number;
  readonly labels: string[];
  private readonly clients: PublicClient[];
  private primaryIdx = 0;
  block = 0n;
  blockTimestamp?: number;
  calls = 0;
  secondaryStatus: ProviderReport["secondaryStatus"] = "not-configured";
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
  }

  get urls(): string[] { return this.labels; }
  get primaryLabel(): string { return this.labels[this.primaryIdx]; }
  get secondaryLabel(): string | null { return this.labels[this.primaryIdx + 1] ?? null; }

  private async withFailover<T>(fn: (c: PublicClient) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = this.primaryIdx; i < this.clients.length; i++) {
      try { const out = await fn(this.clients[i]); if (i !== this.primaryIdx) { this.failovers.push(`${this.labels[this.primaryIdx]} -> ${this.labels[i]}`); this.primaryIdx = i; this.secondaryStatus = this.clients[i + 1] ? "agree" : "not-configured"; } return out; }
      catch (e) { lastErr = e; }
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
    if (this.clients.length > this.primaryIdx + 1) this.secondaryStatus = "agree";
  }

  async chainIdOfPrimary(): Promise<number> { return this.withFailover((c) => c.getChainId()); }

  /** secondary replays run off the primary's critical path, but one at a time so an unbatched node is not flooded */
  private replayChain: Promise<void> = Promise.resolve();

  async read(calls: Call[]): Promise<Record<string, CallResult>> {
    if (calls.length === 0) return {};
    await this.pin();
    const contracts = calls.map((c) => ({ address: c.address, abi: c.abi, functionName: c.functionName, args: c.args ?? [] }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await this.withFailover((c) => c.multicall({ contracts: contracts as any, allowFailure: true, blockNumber: this.block, batchSize: 4096 }));
    this.calls += calls.length;
    const out: Record<string, CallResult> = {};
    calls.forEach((c, i) => { const r = res[i]; out[c.key] = r.status === "success" ? { key: c.key, ok: true, value: r.result } : { key: c.key, ok: false, error: String(r.error?.message ?? r.error).slice(0, 160) }; });
    const secondary = this.clients[this.primaryIdx + 1];
    if (secondary && this.secondaryStatus !== "unavailable") {
      // replay while the caller proceeds with its next stage; results are reconciled in finish()
      this.replayChain = this.replayChain.then(() => this.replay(secondary, calls, contracts, res));
    }
    return out;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async replay(secondary: PublicClient, calls: Call[], contracts: any[], res: readonly { status: string; result?: unknown }[]): Promise<void> {
    if (this.secondaryStatus === "unavailable") return;
    try {
      const run = () => withTimeout(secondary.multicall({ contracts, allowFailure: true, blockNumber: this.block, batchSize: 4096 }), SECONDARY_TIMEOUT_MS, "secondary replay");
      let res2 = await run();
      // a secondary that has not reached the pinned block yet fails every call; give it one retry after a short wait
      if (res2.every((r) => r.status === "failure") && res.some((r) => r.status === "success")) {
        await new Promise((r) => setTimeout(r, 3000)); res2 = await run();
        if (res2.every((r) => r.status === "failure")) { this.secondaryStatus = "unavailable"; this.disagreements.push(`secondary ${this.secondaryLabel} failed every call in a batch (twice); replay stopped for this run`); return; }
      }
      calls.forEach((c, i) => {
        const a = res[i], b = res2[i];
        const av = a.status === "success" ? stringify(a.result) : "ERR", bv = b.status === "success" ? stringify(b.result) : "ERR";
        if (av !== bv) { this.disagreements.push(`${c.key}: primary=${av.slice(0, 80)} secondary=${bv.slice(0, 80)}`); this.secondaryStatus = "disagree"; }
      });
    } catch (e) { this.secondaryStatus = "unavailable"; this.disagreements.push(`secondary error: ${String((e as Error).message ?? e).slice(0, 160)}`); }
  }

  /** Waits for every concurrent secondary replay; call before report(). */
  async finish(): Promise<void> { await this.replayChain; }

  async getCode(addresses: Address[]): Promise<Record<string, boolean>> {
    await this.pin();
    const uniq = [...new Set(addresses.map((a) => a.toLowerCase() as Address))];
    const codes = await this.withFailover((c) => Promise.all(uniq.map((a) => c.getCode({ address: a, blockNumber: this.block }))));
    const out: Record<string, boolean> = {};
    uniq.forEach((a, i) => (out[a] = !!codes[i] && codes[i] !== "0x"));
    return out;
  }

  report(): ProviderReport {
    return { chainId: this.chainId, block: Number(this.block), blockTimestamp: this.blockTimestamp, primary: this.primaryLabel, secondary: this.secondaryLabel, secondaryStatus: this.secondaryStatus, disagreements: [...this.disagreements, ...this.failovers.map((f) => `failover: ${f}`)], calls: this.calls };
  }
}
