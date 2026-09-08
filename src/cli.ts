import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPolicy, loadProviders, loadLabels, loadKnownVaults, loadEnv, p } from "./node/load.ts";
import { MorphoApi } from "./sources/morpho-api/client.ts";
import { checkVault, normalizeAddress, ETHERSCAN_MORPHO_CHAINS, type Deps } from "./pipeline.ts";
import { renderMarkdown, renderConsole } from "./core/render.ts";
import type { Report } from "./core/types.ts";

function usage(): never {
  console.log(`usage:
  npm run check -- check <vault address> [--chain <id>] [--out <dir>] [--quiet]
  npm run check -- batch [--out <dir>]        # every vault in config/known-vaults.json
  npm run check -- find <vault address>       # which chains the Morpho API knows it on`);
  process.exit(1);
}

function deps(): Deps {
  loadEnv();
  const policy = loadPolicy(), providers = loadProviders();
  const key = process.env.ETHERSCAN_API_KEY;
  return {
    policy, providers, labels: loadLabels(policy), api: new MorphoApi(providers.morphoApi),
    etherscan: key ? { base: providers.etherscan.api, apiKey: key, chains: ETHERSCAN_MORPHO_CHAINS } : undefined,
    log: (m) => process.stderr.write(`  ${m}\n`),
  };
}

const save = (r: Report, out: string) => {
  mkdirSync(out, { recursive: true });
  const base = join(out, `${r.vault.chainId}-${r.vault.address.toLowerCase()}`);
  writeFileSync(`${base}.json`, JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  writeFileSync(`${base}.md`, renderMarkdown(r));
  return base;
};

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const out = flag("--out") ?? p("tmp", "reports");
  if (cmd === "check" && args[1]) {
    const d = deps();
    const r = await checkVault(d, args[1], flag("--chain") ? Number(flag("--chain")) : undefined);
    console.log(renderConsole(r));
    const base = save(r, out);
    console.log(`\nsaved ${base}.json and .md`);
  } else if (cmd === "find" && args[1]) {
    const d = deps();
    const found = await d.api.findVault(normalizeAddress(args[1]));
    console.log(found.length ? found.map((f) => `${f.network} (${f.chainId}) ${f.version} ${f.name ?? ""}`).join("\n") : "not indexed by the Morpho API on any chain");
  } else if (cmd === "batch") {
    const d = deps();
    const rows: string[] = [];
    for (const v of loadKnownVaults().vaults) {
      try {
        const r = await checkVault({ ...d, log: () => {} }, v.address, v.chainId);
        save(r, out);
        rows.push(`${r.worst.padEnd(4)} ${v.chainId.toString().padEnd(5)} ${v.address} ${r.checks.map((c) => `${c.id}:${c.status}${c.discrepancy ? "!" : ""}`).join(" ")}  ${v.name}`);
        console.log(rows[rows.length - 1]);
      } catch (e) {
        rows.push(`ERR  ${v.chainId.toString().padEnd(5)} ${v.address} ${(e as Error).message}`);
        console.log(rows[rows.length - 1]);
      }
    }
    writeFileSync(join(out, "batch-summary.txt"), rows.join("\n"));
  } else usage();
}

main().catch((e) => { console.error(`error: ${(e as Error).message}`); process.exit(2); });
