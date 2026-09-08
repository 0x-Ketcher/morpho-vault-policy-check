/**
 * Production server: serves the built page and exposes one proxy route that holds the Etherscan key.
 * The page never sees the key. The route forwards only a short allow-list of read-only Etherscan calls,
 * accepts requests from the page's own origin only, and rate-limits per client address.
 */
import express, { type Request, type Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const PORT = Number(process.env.PORT ?? 3000);
const KEY = process.env.ETHERSCAN_API_KEY;
const ETHERSCAN = process.env.ETHERSCAN_API ?? "https://api.etherscan.io/v2/api";
const ALLOWED: Record<string, Set<string>> = {
  proxy: new Set(["eth_call", "eth_getCode", "eth_blockNumber", "eth_getBlockByNumber", "eth_chainId"]),
  contract: new Set(["getabi", "getsourcecode"]),
};
const LIMIT = Number(process.env.PROXY_RPM ?? 120); // requests per minute per client
const buckets = new Map<string, { start: number; n: number }>();

function limited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.start > 60_000) { buckets.set(ip, { start: now, n: 1 }); return false; }
  b.n++;
  return b.n > LIMIT;
}
function sameOrigin(req: Request): boolean {
  const origin = req.get("origin") ?? (req.get("referer") ? new URL(req.get("referer")!).origin : undefined);
  if (!origin) return true; // same-origin fetches from the page carry no Origin on GET in most browsers
  const host = req.get("x-forwarded-host") ?? req.get("host");
  try { return new URL(origin).host === host; } catch { return false; }
}

const app = express();
app.disable("x-powered-by");

app.get("/api/health", (_req, res) => { res.json({ ok: true, etherscan: !!KEY, limitPerMinute: LIMIT }); });

// the methodology page: README plus the checks and sources documents, served as plain text from the repository itself
app.get("/methodology", (_req, res) => {
  const parts = ["README.md", "docs/CHECKS.md", "docs/DATA_SOURCES.md", "docs/POLICY_MAPPING.md"].filter((f) => existsSync(join(root, f))).map((f) => `# ${f}\n\n${readFileSync(join(root, f), "utf8")}`);
  res.type("text/plain; charset=utf-8").send(parts.join("\n\n\n"));
});

app.get("/api/etherscan", async (req: Request, res: Response) => {
  if (!KEY) { res.status(503).json({ error: "Etherscan fallback is not configured on this server" }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: "cross-origin use of the proxy is not allowed" }); return; }
  const ip = (req.get("x-forwarded-for") ?? req.ip ?? "?").split(",")[0].trim();
  if (limited(ip)) { res.status(429).json({ error: "rate limit exceeded" }); return; }
  const mod = String(req.query.module ?? ""), action = String(req.query.action ?? "");
  if (!ALLOWED[mod]?.has(action)) { res.status(400).json({ error: `not allowed: ${mod}/${action}` }); return; }
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) if (typeof v === "string" && k !== "apikey") q.set(k, v);
  q.set("apikey", KEY);
  try {
    const upstream = await fetch(`${ETHERSCAN}?${q.toString()}`, { signal: AbortSignal.timeout(20_000) });
    const body = await upstream.text();
    res.status(upstream.status).type("application/json").send(body);
  } catch (e) {
    res.status(502).json({ error: `upstream error: ${(e as Error).message}` });
  }
});

if (existsSync(dist)) {
  // hashed assets can be cached for a long time; index.html must always be revalidated or a redeploy is invisible to returning visitors
  app.use(express.static(dist, { index: false, setHeaders: (res, path) => { res.setHeader("Cache-Control", path.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable"); } }));
  app.get(/^(?!\/api\/).*/, (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(join(dist, "index.html")); });
} else {
  app.get("/", (_req, res) => { res.type("text/plain").send("page not built: run npm run build"); });
}

app.listen(PORT, () => { console.log(`listening on :${PORT}; etherscan fallback ${KEY ? "enabled" : "disabled"}; static ${existsSync(dist) ? "dist/" : "missing"}`); });
