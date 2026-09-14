/**
 * The update: refreshes everything the page bakes in at build time and cannot read live per vault, in order, and
 * says what changed. Run it by hand following docs/UPDATE.md; nothing runs on a schedule.
 *   1. labels     registries, the Atlas, Morpho's curator registry            -> labels/registry|atlas|curators.json
 *   2. vault list rate limits on-chain, positions, Skybase, pending spells     -> config/sky-vaults.json
 *   3. safes      owners and thresholds of every known Safe                    -> labels/safes.json
 *   4. docs       the human-readable tables                                    -> docs/POLICY|ADDRESS_BOOK|SAFES|VAULTS.md
 * Exit 0 when every step ran (changed or not); 1 when a step failed, in which case nothing after it ran.
 */
import { spawnSync, execFileSync } from "node:child_process";
import { loadEnv } from "../src/node/load.ts";

loadEnv();
if (!process.env.GITHUB_TOKEN) {
  try { process.env.GITHUB_TOKEN = execFileSync("gh", ["auth", "token"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { console.warn("warning: no GITHUB_TOKEN and no logged-in gh CLI; GitHub is read anonymously (60 calls an hour). If the labels step fails with a 403, log in with `gh auth login` and run again."); }
}

// The sync scripts report their outcome through the exit code: 0 nothing changed, 10 only the pinned source commits
// moved, 20 the table changed. Those mean "completed". Any other code, or a process that could not start, is a
// failure: the update stops there, later steps do not run, and nothing should be committed.
type Step = { name: string; script: string; completed: number[]; read: (code: number, out: string) => string };
const steps: Step[] = [
  { name: "labels", script: "scripts/sync-labels.ts", completed: [0, 10, 20], read: (c) => (c === 20 ? "CHANGED, review the diff of labels/*.json" : c === 10 ? "unchanged (only the pinned source commits moved)" : "unchanged") },
  { name: "vault list", script: "scripts/sync-vaults.ts", completed: [0, 20], read: (c, out) => `${c === 20 ? "CHANGED, review the diff of config/sky-vaults.json" : "unchanged"}${/override STALE/.test(out) ? "; a pending spell has executed: delete its entry in config/vault-overrides.json" : ""}` },
  { name: "safes", script: "scripts/read-safes.ts", completed: [0], read: () => "re-read" },
  { name: "docs", script: "scripts/gen-docs.ts", completed: [0], read: () => "regenerated" },
];
const summary: string[] = [];
for (const s of steps) {
  console.log(`\n== ${s.name} (${s.script})`);
  const r = spawnSync("npx", ["tsx", s.script], { encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  if (r.error) console.error(`could not run ${s.script}: ${r.error.message}`);
  const code = r.status ?? 1;
  if (!s.completed.includes(code)) { console.error(`\n${s.name}: FAILED (exit ${code}); nothing after it ran, nothing to commit yet`); process.exit(1); }
  summary.push(`${s.name}: ${s.read(code, r.stdout + r.stderr)}`);
}
console.log("\n== update summary");
for (const line of summary) console.log(`  ${line}`);
console.log("\nnext: git diff (or git status) to see the changes, npm test, commit, push, then in Railway press Cmd+K and choose \"Deploy Latest Commit\" (docs/UPDATE.md).");
