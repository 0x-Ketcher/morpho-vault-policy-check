import { describe, it, expect } from "vitest";
import { CHECKS } from "../src/core/checks/index.ts";
import type { CheckContext } from "../src/core/checks/index.ts";
import { LabelBook } from "../src/sources/labels/index.ts";
import { loadPolicy } from "../src/node/load.ts";
import type { VaultSnapshot, SafeInfo, Address, Status } from "../src/core/types.ts";

const policy = loadPolicy();
const A = {
  subproxy: "0x1369f7b2b38c76B6478c0f0E66D94923421891Ba" as Address,
  alm: "0x491EDFB0B8b608044e227225C715981a30F3A44E" as Address,
  steak: "0x827e86072B06674a077f592A531dcE4590aDeCdB" as Address,   // external curator Safe
  oeaSafe: "0xB597026150552bB3F6092aC685A2241C5FA77Ed0" as Address, // labeled OEA in this synthetic label set
  sparkCur: "0x0f963A8A8c01042B69054e787E5763ABbB0646A3" as Address, // registry: Spark MORPHO_CURATOR_MULTISIG
  twoOfTwo: "0x622E19d6903BD4507cfc70b31d5B99535114C0FC" as Address,
  unlabeled: "0x59C85fe4385403e93877e48e5521f2F02B150359" as Address,
  eoa1: "0x1111111111111111111111111111111111111111" as Address,
  eoa2: "0x2222222222222222222222222222222222222222" as Address,
  eoa3: "0x3333333333333333333333333333333333333333" as Address,
  eoa4: "0x4444444444444444444444444444444444444444" as Address,
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
  weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
  cbeth: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22" as Address,
};
const labels = new LabelBook({
  registry: { meta: {}, entries: [
    { address: A.subproxy, chainId: 1, prime: "Grove", constant: "GROVE_PROXY", role: "subproxy", file: "src/Ethereum.sol", line: 1, repo: "grove", commit: "abc", url: "" },
    { address: A.alm, chainId: 1, prime: "Grove", constant: "ALM_PROXY", role: "almProxy", file: "src/Ethereum.sol", line: 2, repo: "grove", commit: "abc", url: "" },
    { address: A.sparkCur, chainId: 1, prime: "Spark", constant: "MORPHO_CURATOR_MULTISIG", role: "morphoCurator", file: "src/Ethereum.sol", line: 3, repo: "spark", commit: "abc", url: "" },
  ] },
  curators: { meta: {}, entries: [{ id: "steak", name: "Steakhouse Financial", verified: true, addresses: [{ chainId: 1, address: A.steak }] }] },
  atlas: { meta: {}, entries: [{ address: A.oeaSafe, prime: "OEA Ozone", article: "A.6.1.2.2", title: "OEA Safes", uuid: null, file: "content/x.md", line: 1, text: "- Sentinel: Soter Labs, Safe at …", roleHint: "sentinel", entityHint: "Soter Labs", commit: "abc", url: "" }] },
}, policy);

const safe = (address: Address, threshold: number, owners: Address[], ownerSafes: Record<string, SafeInfo> = {}): SafeInfo => ({ address, isContract: true, isSafe: true, version: "1.4.1", threshold, owners, ownerSafes, source: "onchain" });
const eoa = (address: Address): SafeInfo => ({ address, isContract: false, isSafe: false, source: "onchain" });

function snap(over: Partial<VaultSnapshot> = {}, source: "onchain" | "api" = "onchain"): VaultSnapshot {
  return {
    source, address: "0xbeef05061FE51eA482BD1b68041353490b3a5934", chainId: 1, version: "v2", name: "test", symbol: "T", factoryVerified: true,
    asset: { address: A.usdc, symbol: "USDC", decimals: 6 }, owner: A.subproxy, curator: A.twoOfTwo, guardian: null, sentinels: [A.oeaSafe], allocators: [A.alm],
    adapters: [], markets: [{ id: "0x01", loanToken: A.usdc, collateralToken: A.weth, oracle: "0x0000000000000000000000000000000000000001", irm: null, lltv: 0.86, collateralSymbol: "WETH", supplyAssets: "5000000000", cap: { absolute: "1000000000000" }, allocation: "5000000000" }],
    timelocks: Object.fromEntries(policy.timelocks.vault.map((f) => [f.function, { selector: "0x00000000", seconds: (f.minDays ?? 0) * 86400, abdicated: false }])),
    fees: { performanceFee: 0.1, managementFee: 0 }, exposure: [], meta: { block: 100, fetchedAt: "2026-09-04T00:00:00Z", notes: [] },
    safes: {
      [A.twoOfTwo.toLowerCase()]: safe(A.twoOfTwo, 2, [A.steak, A.eoa1], { [A.steak.toLowerCase()]: safe(A.steak, 2, [A.eoa2, A.eoa3]) }),
      [A.steak.toLowerCase()]: safe(A.steak, 2, [A.eoa2, A.eoa3]),
      [A.oeaSafe.toLowerCase()]: safe(A.oeaSafe, 2, [A.eoa4, "0x5555555555555555555555555555555555555555" as Address]),
      [A.subproxy.toLowerCase()]: { address: A.subproxy, isContract: true, isSafe: false, source: "onchain" },
      [A.alm.toLowerCase()]: { address: A.alm, isContract: true, isSafe: false, source: "onchain" },
    },
    ...over,
  };
}
const ctx = (a: Partial<VaultSnapshot>, b: Partial<VaultSnapshot> = a): CheckContext => ({ policy, labels, a: snap(a), b: snap({ ...b }, "api"), chainName: "Ethereum" });
const run = (id: string, a: Partial<VaultSnapshot>, b?: Partial<VaultSnapshot>) => CHECKS.find((c) => c.id === id)!.evaluate(ctx(a, b));
const status = (id: string, a: Partial<VaultSnapshot>, b?: Partial<VaultSnapshot>): Status => run(id, a, b).status;

describe("C2 chain", () => {
  it("accepts the three chains and fails others", () => {
    expect(status("C2", {})).toBe("PASS");
    expect(status("C2", { chainId: 42161 })).toBe("FAIL");
  });
});

describe("C3 loan asset", () => {
  it("matches by address, not by symbol", () => {
    expect(status("C3", {})).toBe("PASS");
    expect(status("C3", { asset: { address: A.eoa1, symbol: "USDC", decimals: 6 } })).toBe("FAIL");
    expect(status("C3", { asset: { address: A.eoa1, symbol: "FOO", decimals: 18 } })).toBe("FAIL");
  });
});

describe("C4 collateral and LLTV", () => {
  const m = (over: Partial<VaultSnapshot["markets"][0]>) => ({ ...snap().markets[0], ...over });
  it("passes accepted collateral within the maximum", () => { expect(status("C4", {})).toBe("PASS"); });
  it("fails non-accepted collateral with an allocation, warns when cap-only", () => {
    expect(status("C4", { markets: [m({ collateralToken: A.cbeth, collateralSymbol: "cbETH" })] })).toBe("FAIL");
    expect(status("C4", { markets: [m({ collateralToken: A.cbeth, collateralSymbol: "cbETH", allocation: "0", supplyAssets: "0" })] })).toBe("WARN");
  });
  it("treats dust below one unit as cap-only", () => { expect(status("C4", { markets: [m({ collateralToken: A.cbeth, collateralSymbol: "cbETH", allocation: "999999", supplyAssets: "999999" })] })).toBe("WARN"); });
  it("fails an LLTV above the maximum and warns on a symbol match with an unknown address", () => {
    expect(status("C4", { markets: [m({ lltv: 0.915 })] })).toBe("FAIL");
    expect(status("C4", { markets: [m({ collateralToken: A.eoa2, collateralSymbol: "WETH" })] })).toBe("WARN");
  });
  it("is n/a for an idle vault", () => { expect(status("C4", { markets: [] })).toBe("NA"); });
});

describe("C5 owner", () => {
  it("passes Prime governance, warns on an n-of-n Safe with governance, fails the rest", () => {
    expect(status("C5", {})).toBe("PASS");
    const s = snap();
    const veto = { ...s.safes, [A.unlabeled.toLowerCase()]: safe(A.unlabeled, 2, [A.steak, A.subproxy]) };
    expect(status("C5", { owner: A.unlabeled, safes: veto })).toBe("WARN");
    const noVeto = { ...s.safes, [A.unlabeled.toLowerCase()]: safe(A.unlabeled, 2, [A.steak, A.subproxy, A.eoa1]) };
    expect(status("C5", { owner: A.unlabeled, safes: noVeto })).toBe("FAIL");
    expect(status("C5", { owner: A.steak })).toBe("FAIL");
  });
});

describe("C6 curator", () => {
  it("passes a 2/2 of external curator and directly labeled OEA", () => {
    const s = snap();
    const two = { ...s.safes, [A.twoOfTwo.toLowerCase()]: safe(A.twoOfTwo, 2, [A.steak, A.oeaSafe], { [A.steak.toLowerCase()]: s.safes[A.steak.toLowerCase()], [A.oeaSafe.toLowerCase()]: s.safes[A.oeaSafe.toLowerCase()] }) };
    expect(status("C6", { safes: two })).toBe("PASS");
  });
  it("warns when the co-signer is unlabeled", () => { expect(status("C6", {})).toBe("WARN"); });
  it("fails an external curator Safe on its own", () => { expect(status("C6", { curator: A.steak })).toBe("FAIL"); });
  it("warns on a Prime-labeled self-curated Safe, fails an unattributable one", () => {
    const s = snap();
    const withSpark = { ...s.safes, [A.sparkCur.toLowerCase()]: safe(A.sparkCur, 3, [A.eoa1, A.eoa2, A.eoa3, A.eoa4, "0x5555555555555555555555555555555555555555" as Address]) };
    expect(status("C6", { curator: A.sparkCur, safes: withSpark })).toBe("WARN");
    const unknown = { ...s.safes, [A.unlabeled.toLowerCase()]: safe(A.unlabeled, 3, [A.eoa1, A.eoa2, A.eoa3]) };
    expect(status("C6", { curator: A.unlabeled, safes: unknown })).toBe("FAIL");
  });
});

describe("C7 sentinel", () => {
  it("passes a directly labeled OEA Safe with disjoint signers", () => { expect(status("C7", {})).toBe("PASS"); });
  it("warns when the OEA Safe shares a signer with the curator Safe", () => {
    const s = snap();
    const shared = { ...s.safes, [A.oeaSafe.toLowerCase()]: safe(A.oeaSafe, 2, [A.eoa1, A.eoa4]) }; // eoa1 also signs the curator Safe
    expect(status("C7", { safes: shared })).toBe("WARN");
  });
  it("fails Prime-side, curator-side and missing sentinels", () => {
    expect(status("C7", { sentinels: [A.subproxy] })).toBe("FAIL");
    expect(status("C7", { sentinels: [A.steak] })).toBe("FAIL");
    expect(status("C7", { sentinels: [] })).toBe("FAIL");
  });
  it("warns on an unlabeled OEA-shaped Safe", () => {
    const s = snap();
    const u = { ...s.safes, [A.unlabeled.toLowerCase()]: safe(A.unlabeled, 2, [A.eoa4, "0x6666666666666666666666666666666666666666" as Address]) };
    expect(status("C7", { sentinels: [A.unlabeled], safes: u })).toBe("WARN");
  });
  it("uses the guardian on v1.1", () => {
    expect(status("C7", { version: "v1.1", sentinels: [], guardian: A.oeaSafe })).toBe("PASS");
    expect(status("C7", { version: "v1.1", sentinels: [], guardian: A.subproxy })).toBe("FAIL");
  });
});

describe("C9 timelocks", () => {
  it("passes at the minimums and fails one below", () => {
    expect(status("C9", {})).toBe("PASS");
    const t = { ...snap().timelocks, "addAdapter(address)": { selector: "0x00000000" as const, seconds: 3 * 86400, abdicated: false } };
    expect(status("C9", { timelocks: t })).toBe("FAIL");
  });
  it("accepts an abdicated gate", () => {
    const t = { ...snap().timelocks, "setSendSharesGate(address)": { selector: "0x00000000" as const, seconds: 0, abdicated: true } };
    expect(status("C9", { timelocks: t })).toBe("PASS");
  });
  it("fails a 0-day adapter timelock", () => {
    expect(status("C9", { adapters: [{ address: A.eoa1, markets: [], timelocks: { "abdicate(bytes4)": 0, "burnShares(bytes32)": 3 * 86400, "increaseTimelock(bytes4,uint256)": 7 * 86400, "setSkimRecipient(address)": 3 * 86400 }, abdicated: {} }] })).toBe("FAIL");
  });
});

describe("discrepancies", () => {
  it("flags a value that differs between the two methods and keeps the on-chain verdict", () => {
    const r = run("C5", {}, { owner: A.steak });
    expect(r.status).toBe("PASS");
    expect(r.discrepancy).toBe(true);
    expect(r.discrepancies[0]).toContain("onchain");
  });
  it("marks single-source values when there is no on-chain snapshot", () => {
    const r = CHECKS.find((c) => c.id === "C5")!.evaluate({ policy, labels, a: null, b: snap({}, "api"), chainName: "Ethereum" });
    expect(r.singleSource).toBe(true);
  });
});
