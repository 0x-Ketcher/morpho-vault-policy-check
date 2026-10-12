import { describe, it, expect } from "vitest";
import { compareHeads } from "../src/web/freshness.ts";

/** The banner's verdict comes from the current pins, never from a cached verdict: a new deploy with fresh pins clears it. */
describe("label freshness banner", () => {
  const heads = [{ repo: "grove-labs/grove-address-registry", head: "622981e8" }, { repo: "sky-ecosystem/next-gen-atlas", head: "1eae57d3" }, { repo: "osero-io/osero-address-registry", head: null, error: "GitHub API 403" }];
  it("flags a repository whose head moved past the pin, and only that one", () => {
    const out = compareHeads({ "grove-labs/grove-address-registry": "09b15282", "sky-ecosystem/next-gen-atlas": "1eae57d3" }, heads);
    expect(out.map((f) => [f.repo.split("/")[1], f.behind])).toEqual([["grove-address-registry", true], ["next-gen-atlas", false], ["osero-address-registry", null]]);
  });
  it("clears the flag as soon as the pins catch up, with the same cached heads", () => {
    const out = compareHeads({ "grove-labs/grove-address-registry": "622981e8", "sky-ecosystem/next-gen-atlas": "1eae57d3" }, heads);
    expect(out.filter((f) => f.behind)).toHaveLength(0);
  });
  it("reports unknown, not stale, when a head could not be read or a pin is missing", () => {
    const out = compareHeads({}, heads);
    expect(out.every((f) => f.behind === null)).toBe(true);
    expect(out[2].error).toBe("GitHub API 403");
  });
});
