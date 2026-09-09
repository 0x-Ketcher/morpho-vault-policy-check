import { custom, type Transport } from "viem";

/**
 * A viem transport that speaks to Etherscan's v2 "proxy" module, so Etherscan can serve as a failover
 * on-chain provider behind the same reader. `base` is either the Etherscan API (with an apiKey) or the
 * app's own server-side proxy route (no key in the browser).
 */
export function etherscanTransport(opts: { chainId: number; base: string; apiKey?: string; minIntervalMs?: number; fetchImpl?: typeof fetch }): Transport {
  const f = opts.fetchImpl ?? fetch;
  let last = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const gap = opts.minIntervalMs ?? 340; // this key's plan allows 3 calls per second
  // calls are serialised through one queue so concurrent callers (Multicall chunks, getCode batches) cannot exceed the rate
  const call = (params: Record<string, string>) => {
    const run = queue.then(async () => {
      const wait = last + gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return callNow(params);
    });
    queue = run.catch(() => undefined);
    return run;
  };
  const callNow = async (params: Record<string, string>) => {
    const q = new URLSearchParams({ chainid: String(opts.chainId), module: "proxy", ...params });
    if (opts.apiKey) q.set("apikey", opts.apiKey);
    const res = await f(`${opts.base}?${q.toString()}`);
    const body = (await res.json()) as { result?: unknown; error?: { message?: string }; status?: string; message?: string };
    if (body.error) throw new Error(`etherscan: ${body.error.message ?? "error"}`);
    if (body.status === "0") throw new Error(`etherscan: ${String(body.result ?? body.message)}`);
    return body.result;
  };
  return custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      const p = (params ?? []) as unknown[];
      switch (method) {
        case "eth_chainId": return `0x${opts.chainId.toString(16)}`;
        case "eth_blockNumber": return call({ action: "eth_blockNumber" });
        case "eth_getBlockByNumber": return call({ action: "eth_getBlockByNumber", tag: String(p[0]), boolean: String(!!p[1]) });
        case "eth_call": { const tx = p[0] as { to: string; data: string }; return call({ action: "eth_call", to: tx.to, data: tx.data, tag: String(p[1] ?? "latest") }); }
        case "eth_getCode": return call({ action: "eth_getCode", address: String(p[0]), tag: String(p[1] ?? "latest") });
        default: throw new Error(`etherscan transport: unsupported method ${method}`);
      }
    },
  }, { name: "etherscan", key: "etherscan", retryCount: 0 });
}
