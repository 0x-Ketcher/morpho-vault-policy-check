import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { loadPolicy, loadLabels, loadJson, p } from "../src/node/load.ts";
import { CHECKS } from "../src/core/checks/index.ts";
import type { VaultSnapshot, Status, ProviderReport } from "../src/core/types.ts";

const policy = loadPolicy();
const labels = loadLabels(policy);
const expected = loadJson<{ vaults: { name: string; chainId: number; address: string; expect: Record<string, Status>; note?: string }[] }>("tests/fixtures/expected_verdicts.json");
const dir = p("tests/fixtures/recorded");
const recorded = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];

describe("regression against the September 2026 review (recorded snapshots, committed labels)", () => {
  it("has recorded fixtures", () => { expect(recorded.length).toBeGreaterThan(0); });
  for (const v of expected.vaults) {
    const file = `${v.chainId}-${v.address.toLowerCase()}.json`;
    it(`${v.name} (${v.address})`, () => {
      if (!recorded.includes(file)) { console.warn(`no recorded fixture for ${v.name}; run npm run record:fixtures`); return; }
      const rec = JSON.parse(readFileSync(p("tests/fixtures/recorded", file), "utf8")) as { snapshotA: VaultSnapshot | null; snapshotB: VaultSnapshot; providers: ProviderReport };
      const ctx = { policy, labels, a: rec.snapshotA, b: rec.snapshotB, chainName: String(v.chainId) };
      const got: Record<string, Status> = {};
      for (const c of CHECKS) got[c.id] = c.evaluate(ctx).status;
      for (const [id, status] of Object.entries(v.expect)) expect(got[id], `${id} for ${v.name}`).toBe(status);
    });
  }
});
