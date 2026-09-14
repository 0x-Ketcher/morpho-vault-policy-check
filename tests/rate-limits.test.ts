import { describe, it, expect } from "vitest";
import { getAddress } from "viem";
import { RATE_LIMIT_SET_TOPIC, prefixHash, keyFor, depositKey, buildKeyTable, keysFromLogs, addressesFromCreationLogs, prefixesFromSource, classify } from "../src/core/rate-limits.ts";
import { depositRateLimitKey } from "../src/sources/onchain/vault.ts";

// A key observed on-chain: Spark ALM_RATE_LIMITS emitted RateLimitDataSet for it three times (2026-03-02, 2026-04-13,
// 2026-07-20). It is LIMIT_4626_DEPOSIT for the Vault V2 twin of the Spark Blue Chip USDT vault.
const TWIN = "0xc7cdcfdefc64631ed6799c95e3b110cd42f2bd22";
const TWIN_KEY = "0x854a144d87be6e4837fb79d8a8477475b5a6a15b4566b9c3cb1a5674ceb6ce0d";

const A = {
  twin: TWIN,
  live: "0xb0c424116172b55cbb6dd3136f5989f7959e5b91", // the listed Spark Blue Chip USDT vault, same name as the twin
  other: "0xbeeff08df54897e7544ab01d0e86f013da354111",
  token: "0xdac17f958d2ee523a2206206994597c13d831ec7",
};
const candidates = new Map([
  [A.twin, 'Morpho vault "Spark Blue Chip USDT Vault" (chain 1)'],
  [A.live, 'Morpho vault "Spark Blue Chip USDT Vault" (chain 1)'],
  [A.other, 'Morpho vault "Grove x Steakhouse USDC" (chain 1)'],
  [A.token, "Spark registry USDT (chain 1)"],
]);
const keyTable = buildKeyTable({ prefixes: ["LIMIT_4626_DEPOSIT", "LIMIT_4626_WITHDRAW", "LIMIT_USDS_MINT", "LIMIT_ASSET_TRANSFER"], candidates, pairAddrs: [A.token, A.other], ids: [1, 30101], domains: 8 });
const val = (maxAmount: bigint, lastUpdated: bigint) => ({ maxAmount, lastUpdated });

describe("rate-limit keys", () => {
  it("derives the key the Prime contracts actually use", () => {
    expect(depositKey(TWIN)).toBe(TWIN_KEY);
    expect(keyFor("LIMIT_4626_DEPOSIT", ["address"], [getAddress(TWIN)])).toBe(TWIN_KEY);
    expect(depositRateLimitKey(getAddress(TWIN)).toLowerCase()).toBe(TWIN_KEY); // the checks and the sync derive it the same way
    expect(RATE_LIMIT_SET_TOPIC).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("keeps same-named vaults apart in the key table", () => {
    const { table, keyAddr } = keyTable;
    expect(table.get(depositKey(A.twin))).toBe(table.get(depositKey(A.live))); // identical description
    expect(keyAddr.get(depositKey(A.twin))).toBe(A.twin);
    expect(keyAddr.get(depositKey(A.live))).toBe(A.live); // but the address is the one encoded into the key
    expect(table.get(prefixHash("LIMIT_USDS_MINT").toLowerCase())).toBe("LIMIT_USDS_MINT (plain)"); // a plain key is the prefix hash itself
    expect(table.get(keyFor("LIMIT_4626_DEPOSIT", ["uint32"], [3]))).toBe("LIMIT_4626_DEPOSIT x domain 3");
    expect(table.has(keyFor("LIMIT_ASSET_TRANSFER", ["address", "address"], [getAddress(A.token), getAddress(A.other)]))).toBe(true);
  });
});

describe("rate-limit classification", () => {
  const listed = new Set([`1:Spark:${A.live}`]);
  it("flags a live deposit key for a vault the list lacks, and only that one", () => {
    const keys = [depositKey(A.live), depositKey(A.twin), depositKey(A.other)];
    const values = { [depositKey(A.live)]: val(100n, 5n), [depositKey(A.twin)]: val(50n, 5n), [depositKey(A.other)]: val(20n, 5n) };
    const c = classify({ keys, values, keyTable, listed, chainId: 1, prime: "Spark" });
    expect(c.vaultKeys.map((v) => [v.address, v.inList])).toEqual([[A.live, true], [A.twin, false], [A.other, false]]);
    expect(c.unexplained).toEqual([]);
  });
  it("treats a zeroed key as offboarded, not live, and never as missing", () => {
    const keys = [depositKey(A.twin), depositKey(A.live)];
    const values = { [depositKey(A.twin)]: val(0n, 1784557583n), [depositKey(A.live)]: val(100n, 5n) };
    const c = classify({ keys, values, keyTable, listed, chainId: 1, prime: "Spark" });
    expect(c.live).toEqual([depositKey(A.live)]);
    expect(c.zeroed).toEqual([depositKey(A.twin)]);
    expect(c.zeroedVaultKeys.map((z) => z.address)).toEqual([A.twin]);
    expect(c.vaultKeys.filter((v) => !v.inList)).toEqual([]);
  });
  it("separates explained non-vault keys from keys nothing explains", () => {
    const mystery = "0x" + "ab".repeat(32);
    const keys = [prefixHash("LIMIT_USDS_MINT").toLowerCase(), keyFor("LIMIT_4626_WITHDRAW", ["address"], [getAddress(A.live)]), mystery];
    const values = Object.fromEntries(keys.map((k) => [k, val(1n, 1n)]));
    const c = classify({ keys, values, keyTable, listed, chainId: 1, prime: "Spark" });
    expect(c.vaultKeys).toEqual([]);
    expect(c.unexplained).toEqual([mystery]);
    expect(c.otherPrefixes.sort()).toEqual(["LIMIT_4626_WITHDRAW", "LIMIT_USDS_MINT (plain)"]);
  });
  it("refuses to classify a key whose value was never read", () => {
    expect(() => classify({ keys: [depositKey(A.live)], values: {}, keyTable, listed, chainId: 1, prime: "Spark" })).toThrow(/no value read/);
  });
  it("respects the Prime: the same vault listed for Grove is missing for Spark", () => {
    const c = classify({ keys: [depositKey(A.other)], values: { [depositKey(A.other)]: val(1n, 1n) }, keyTable, listed: new Set([`1:Grove:${A.other}`]), chainId: 1, prime: "Spark" });
    expect(c.vaultKeys[0].inList).toBe(false);
  });
});

describe("log and source parsing", () => {
  const pad = (a: string) => "0x" + "0".repeat(24) + a.slice(2);
  it("reads the distinct keys from RateLimitDataSet logs", () => {
    const logs = [{ topics: [RATE_LIMIT_SET_TOPIC, TWIN_KEY] }, { topics: [RATE_LIMIT_SET_TOPIC, TWIN_KEY.toUpperCase().replace("0X", "0x")] }, { topics: [RATE_LIMIT_SET_TOPIC, depositKey(A.live)] }];
    expect(keysFromLogs(logs)).toEqual([TWIN_KEY, depositKey(A.live)]);
  });
  it("takes every address-shaped topic from a creation log, whatever the event layout", () => {
    const logs = [{ topics: ["0xsig", pad(A.live), pad(A.token), "0x" + "ff".repeat(32)] }, { topics: ["0xsig", pad(A.other)] }];
    expect(addressesFromCreationLogs(logs)).toEqual([A.live, A.token, A.other]);
  });
  it("finds every LIMIT_ prefix in a verified source once", () => {
    const src = 'bytes32 public constant LIMIT_4626_DEPOSIT = keccak256("LIMIT_4626_DEPOSIT"); LIMIT_OTC_SWAP LIMIT_UNISWAP_V4_SWAP; limit_lower';
    expect(prefixesFromSource(src)).toEqual(["LIMIT_4626_DEPOSIT", "LIMIT_OTC_SWAP", "LIMIT_UNISWAP_V4_SWAP"]);
  });
});
