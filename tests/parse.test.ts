import { describe, it, expect } from "vitest";
import { parseRegistrySol, parseAtlasMarkdown, atlasHints, ADDRESS_RE } from "../src/sources/labels/parse.ts";
import { roleFromConstant } from "../src/sources/labels/index.ts";

describe("registry parser", () => {
  it("extracts constants with line numbers", () => {
    const sol = `// SPDX\nlibrary Ethereum {\n    address internal constant SPARK_PROXY = 0x3300f198988e4C9C63F75dF86De36421f06af8c4;\n    address internal constant MORPHO_CURATOR_MULTISIG           = 0x0f963A8A8c01042B69054e787E5763ABbB0646A3;\n    uint256 internal constant NOT_AN_ADDRESS = 5;\n}`;
    const out = parseRegistrySol(sol);
    expect(out).toEqual([
      { constant: "SPARK_PROXY", address: "0x3300f198988e4C9C63F75dF86De36421f06af8c4", line: 3 },
      { constant: "MORPHO_CURATOR_MULTISIG", address: "0x0f963A8A8c01042B69054e787E5763ABbB0646A3", line: 4 },
    ]);
  });
  it("maps constant names to roles", () => {
    expect(roleFromConstant("GROVE_PROXY")).toBe("subproxy");
    expect(roleFromConstant("SPARK_EXECUTOR")).toBe("executor");
    expect(roleFromConstant("ALM_PROXY_FREEZABLE")).toBe("almProxy");
    expect(roleFromConstant("ALM_RATE_LIMITS")).toBe("almRateLimits");
    expect(roleFromConstant("PAU_RATE_LIMITS")).toBe("almRateLimits");
    expect(roleFromConstant("OSERO_RATE_LIMITS")).toBe("almRateLimits");
    expect(roleFromConstant("PAU_PROXY")).toBe("almProxy");
    expect(roleFromConstant("OSERO_ALM_PROXY")).toBe("almProxy");
    expect(roleFromConstant("PAU_ADMINISTERED_AGENT")).toBe("almProxy");
    expect(roleFromConstant("PAU_ADMINISTERED_AGENT_FACTORY")).toBe("other");
    expect(roleFromConstant("PAUSE_PROXY")).toBe("other");
    expect(roleFromConstant("MORPHO_GUARDIAN_MULTISIG")).toBe("morphoGuardian");
    expect(roleFromConstant("GROVE_X_STEAKHOUSE_USDC_HY_V2_MORPHO_VAULT")).toBe("morphoVault");
    expect(roleFromConstant("MORPHO_VAULT_V2_FACTORY")).toBe("morphoV2Factory");
    expect(roleFromConstant("SOTER_OPERATOR")).toBe("oeaOperator");
    expect(roleFromConstant("USDC")).toBe("token");
  });
});

describe("atlas parser", () => {
  it("does not mistake a 32-byte id for an address", () => {
    const line = "The inflow RateLimitID is: `0x01ccccb0233955b3de85eca4dcc78aaf2aa6da1cf048b496e85a91396c2feab6`.";
    expect(line.match(ADDRESS_RE)).toBeNull();
  });
  it("attaches the nearest numbered heading and extracts role and entity hints", () => {
    const md = [
      "###### A.6.1.1.1.3.9.7.2.1 - Spark USDS Morpho Vault - Ethereum Mainnet [Core]  <!-- UUID: 3e8ed24b-da4a-4c3f-8c0a-000000000000 -->",
      "",
      "- Curator: Soter Labs, implemented via a Gnosis Safe multisig at `0x0f963A8A8c01042B69054e787E5763ABbB0646A3`, requiring a 3 of 5 signer approval.",
      "- Guardian: Spark Foundation, implemented via a Gnosis Safe multisig at `0xf5748bBeFa17505b2F7222B23ae11584932C908B`, requiring a 3 of 5 signer approval.",
      "###### A.6.1.1.2.2.6.1.3.1.14.1.4.2.1.1 - Proposer Role Holder [Core]",
      "The `PROPOSER_ROLE` of the Owner Timelock is held by Anemoy at `0x9184DdBCc4824B76CE2AEFA72534a1a87aA5037c`.",
    ].join("\n");
    const out = parseAtlasMarkdown(md, "A.6.1.1.1", "content/A.6.1.1.1 - Spark.md");
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ address: "0x0f963A8A8c01042B69054e787E5763ABbB0646A3", article: "A.6.1.1.1.3.9.7.2.1", uuid: "3e8ed24b-da4a-4c3f-8c0a-000000000000", line: 3, roleHint: "curator", entityHint: "Soter Labs" });
    expect(out[1]).toMatchObject({ roleHint: "guardian", entityHint: "Spark Foundation" });
    expect(out[2]).toMatchObject({ article: "A.6.1.1.2.2.6.1.3.1.14.1.4.2.1.1", roleHint: "owner", entityHint: "Anemoy" });
  });
  it("uses the heading when the line has no role word", () => {
    expect(atlasHints("`0x0f963A8A8c01042B69054e787E5763ABbB0646A3`", "A.x - Curator Role Address [Core]")).toEqual({ roleHint: "curator", entityHint: null });
  });
});
