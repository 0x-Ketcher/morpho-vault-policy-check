import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { p } from "../src/node/load.ts";

/** No personal names and no secrets anywhere in the repository text. The name list itself stays out of the repo:
 *  it comes from the SCRUB_TERMS environment variable (a regex), set locally or as a CI secret. */
const SKIP = new Set(["node_modules", "dist", "dist-server", "tmp", ".git", "package-lock.json"]);
function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const f = join(dir, name);
    if (statSync(f).isDirectory()) yield* walk(f);
    else if (/\.(ts|tsx|md|json|yml|yaml|html|css|txt|example)$/.test(name)) yield f;
  }
}
const files = [...walk(p())];

describe("repository text scrub", () => {
  it("scans a meaningful number of files", () => { expect(files.length).toBeGreaterThan(20); });
  it("contains no Etherscan-key-shaped token", () => {
    const re = /(?<![A-Za-z0-9])[A-Z0-9]{34}(?![A-Za-z0-9])/;
    for (const f of files) {
      const hit = re.exec(readFileSync(f, "utf8"));
      expect(hit, `${f}: ${hit?.[0]}`).toBeNull();
    }
  });
  it("contains none of the configured personal names (SCRUB_TERMS)", () => {
    const terms = process.env.SCRUB_TERMS;
    if (!terms) { console.warn("SCRUB_TERMS not set; name scrub skipped (set it locally or as a CI secret)"); return; }
    const re = new RegExp(terms, "i");
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      const m = re.exec(text);
      expect(m, `${f} line ${text.slice(0, m?.index ?? 0).split("\n").length}: ${m?.[0]}`).toBeNull();
    }
  });
});
