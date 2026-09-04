/**
 * Records the two snapshots (on-chain and API) for every vault in tests/fixtures/expected_verdicts.json into
 * tests/fixtures/recorded/, so the regression test can run offline against committed labels and policy.
 * Usage: npm run record:fixtures            (live run, ~15 s per vault)
 *        npm run record:fixtures -- --from-dir tmp/batch1   (reuse reports saved by the CLI)
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadPolicy, loadProviders, loadLabels, loadJson, loadEnv, p } from "../src/node/load.ts";
import { MorphoApi } from "../src/sources/morpho-api/client.ts";
import { checkVault, ETHERSCAN_MORPHO_CHAINS } from "../src/pipeline.ts";
import type { Report } from "../src/core/types.ts";

loadEnv();
const expected = loadJson<{ vaults: { name: string; chainId: number; address: string }[] }>("tests/fixtures/expected_verdicts.json");
const fromDir = process.argv.includes("--from-dir") ? process.argv[process.argv.indexOf("--from-dir") + 1] : undefined;
mkdirSync(p("tests/fixtures/recorded"), { recursive: true });
const policy = loadPolicy(), providers = loadProviders();
const key = process.env.ETHERSCAN_API_KEY;
const deps = { policy, providers, labels: loadLabels(policy), api: new MorphoApi(providers.morphoApi), etherscan: key ? { base: providers.etherscan.api, apiKey: key, chains: ETHERSCAN_MORPHO_CHAINS } : undefined };
for (const v of expected.vaults) {
  const file = `${v.chainId}-${v.address.toLowerCase()}.json`;
  let report: Report | undefined;
  if (fromDir) {
    const src = join(fromDir, file);
    if (!existsSync(src)) { console.log(`${v.name}: not in ${fromDir}, skipped`); continue; }
    report = JSON.parse(readFileSync(src, "utf8")) as Report;
  } else {
    report = await checkVault(deps, v.address, v.chainId);
  }
  const rec = { name: v.name, recordedAt: report.generatedAt, providers: report.providers, snapshotA: report.snapshotA, snapshotB: report.snapshotB };
  writeFileSync(p("tests/fixtures/recorded", file), JSON.stringify(rec, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 1) + "\n");
  console.log(`${v.name}: recorded (${report.checks.map((c) => `${c.id}:${c.status}`).join(" ")})`);
}
