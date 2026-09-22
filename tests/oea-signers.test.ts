import { describe, it, expect } from "vitest";
import { getAddress } from "viem";
import { loadJson } from "../src/node/load.ts";
import type { OeaSignersFile } from "../src/sources/labels/index.ts";

/** The hand-maintained OEA signer table must stay small, well-formed and free of anything but keys. */
describe("config/oea-signers.json", () => {
  const t = loadJson<OeaSignersFile>("config/oea-signers.json");
  it("names the entity and carries no link (a repository URL would name the account that owns it)", () => {
    expect(t.entity).toBe("Operational Executor Agent");
    expect(t.url).toBeUndefined();
  });
  it("holds checksummed, unique keys with only address, role and since", () => {
    const seen = new Set<string>();
    for (const k of t.keys) {
      expect(k.address).toBe(getAddress(k.address));
      expect(seen.has(k.address.toLowerCase())).toBe(false);
      seen.add(k.address.toLowerCase());
      for (const field of Object.keys(k)) expect(["address", "role", "since"]).toContain(field);
      if (k.since) expect(k.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
