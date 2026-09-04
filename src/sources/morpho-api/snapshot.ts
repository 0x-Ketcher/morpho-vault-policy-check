import { getAddress } from "viem";
import type { Address, Hex, VaultSnapshot, VaultVersion, SafeInfo, MarketInfo, AdapterInfo } from "../../core/types.ts";
import { MorphoApi } from "./client.ts";
import { fetchSafe } from "../safe/service.ts";
import { selectorOf } from "../onchain/abis.ts";
import type { LabelBook } from "../labels/index.ts";
import type { TimelockPolicy } from "../onchain/vault.ts";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/** Method B: the Morpho API for vault state, the Safe Transaction Service for Safe structure. */
export async function buildApiSnapshot(api: MorphoApi, safeBase: string | undefined, vault: Address, chainId: number, version: VaultVersion, labels: LabelBook, tl: TimelockPolicy): Promise<VaultSnapshot> {
  const notes: string[] = [];
  const snap: VaultSnapshot = {
    source: "api", address: vault, chainId, version, asset: { address: ZERO }, owner: ZERO, curator: ZERO, guardian: null,
    sentinels: [], allocators: [], adapters: [], markets: [], timelocks: {}, fees: {}, exposure: [], safes: {},
    meta: { fetchedAt: new Date().toISOString(), providers: [api["url"] as string], notes },
  };
  if (version === "v2") await fillV2(api, vault, chainId, snap, tl, notes);
  else await fillV1(api, vault, chainId, snap, notes);

  // Sky exposure via API positions of every labeled Prime ALM proxy on this chain
  for (const p of labels.byRole("almProxy", chainId)) {
    const pos = await api.position(p.address as Address, vault, chainId, version);
    snap.exposure.push({ prime: p.prime, almProxy: p.address as Address, almProxyLabel: p.constant, shares: pos?.shares ?? "0", assets: pos?.assets ?? "0", assetsUsd: pos?.assetsUsd ?? 0 });
  }
  notes.push("Rate limits (Liquidity Layer onboarding) have no Morpho API equivalent; that value is on-chain only.");

  // Safe structure via the Safe Transaction Service, one level of nesting
  const roleAddrs = [...new Set([snap.owner, snap.curator, snap.guardian ?? ZERO, ...snap.sentinels, ...snap.allocators].filter((a) => a && a !== ZERO))] as Address[];
  const level1 = await safeLevel(safeBase, roleAddrs, notes);
  const nested = [...new Set(Object.values(level1).flatMap((s) => (s.isSafe ? s.owners ?? [] : [])))].filter((a) => !level1[a.toLowerCase()]);
  const level2 = await safeLevel(safeBase, nested, notes);
  for (const s of Object.values(level1)) {
    if (!s.isSafe) continue;
    s.ownerSafes = {};
    for (const o of s.owners ?? []) { const n = level2[o.toLowerCase()] ?? level1[o.toLowerCase()]; if (n) s.ownerSafes[o.toLowerCase()] = n; }
  }
  snap.safes = { ...level2, ...level1 };
  return snap;
}

async function safeLevel(safeBase: string | undefined, addrs: Address[], notes: string[]): Promise<Record<string, SafeInfo>> {
  const out: Record<string, SafeInfo> = {};
  for (const a of addrs) {
    const r = await fetchSafe(safeBase, a);
    if (r === "unavailable") { out[a.toLowerCase()] = { address: a, isContract: false, isSafe: false, unavailable: true, source: "safe-service" }; if (!notes.includes("Safe Transaction Service unavailable for this chain; Safe structure is on-chain only in this run")) notes.push("Safe Transaction Service unavailable for this chain; Safe structure is on-chain only in this run"); continue; }
    if (r === null) { out[a.toLowerCase()] = { address: a, isContract: false, isSafe: false, source: "safe-service" }; continue; }
    out[a.toLowerCase()] = { address: a, isContract: true, isSafe: true, owners: r.owners.map((o) => getAddress(o)), threshold: r.threshold, version: r.version, source: "safe-service" };
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fillV2(api: MorphoApi, vault: Address, chainId: number, snap: VaultSnapshot, tl: TimelockPolicy, notes: string[]) {
  const d = await api.vaultV2(vault, chainId);
  if (!d) throw new Error("Morpho API has no Vault V2 at this address on this chain");
  const dec = Number(d.asset?.decimals ?? 0);
  const price = d.asset?.price?.usd as number | undefined;
  snap.name = d.name; snap.symbol = d.symbol;
  snap.asset = { address: getAddress(d.asset.address), symbol: d.asset.symbol, decimals: dec };
  snap.factory = d.factory?.address ? getAddress(d.factory.address) : undefined;
  snap.factoryVerified = d.factory?.address ? true : null;
  notes.push("The Morpho API only indexes vaults deployed by the official factories, so being listed here counts as the API-side factory confirmation.");
  snap.owner = addr(d.owner?.address); snap.curator = addr(d.curator?.address);
  snap.sentinels = (d.sentinels ?? []).map((s: { sentinel: { address: string } }) => getAddress(s.sentinel.address));
  snap.allocators = (d.allocators ?? []).map((a: { allocator: { address: string } }) => getAddress(a.allocator.address));
  const sigBySelector = new Map<string, string>();
  for (const f of [...tl.vault, ...tl.informational, ...tl.adapter]) sigBySelector.set(selectorOf(f.function).toLowerCase(), f.function);
  for (const t of d.timelocks ?? []) {
    const sig = sigBySelector.get(String(t.selector).toLowerCase()) ?? `${t.functionName}[${t.selector}]`;
    snap.timelocks[sig] = { selector: t.selector as Hex, seconds: Number(t.duration), abdicated: t.abdicatedAt != null };
  }
  snap.fees = { performanceFee: num(d.performanceFee), managementFee: num(d.managementFee), performanceFeeRecipient: opt(d.performanceFeeRecipient), managementFeeRecipient: opt(d.managementFeeRecipient) };
  snap.gates = {};
  for (const g of ["receiveSharesGate", "sendSharesGate", "receiveAssetsGate", "sendAssetsGate"]) {
    const cfg = d.gatesConfig?.[g];
    if (cfg) snap.gates[g] = { address: addr(cfg.address), abdicated: !!cfg.abdicated };
  }
  snap.totalAssets = d.totalAssets != null ? String(d.totalAssets) : undefined;
  snap.totalAssetsUsd = num(d.totalAssetsUsd); snap.idleAssetsUsd = num(d.idleAssetsUsd);
  const adapters: AdapterInfo[] = (d.adapters?.items ?? []).map((a: { address: string; type: string; assetsUsd: number; forceDeallocatePenalty: string }) => ({
    address: getAddress(a.address), type: a.type, markets: [], assetsUsd: num(a.assetsUsd), forceDeallocatePenalty: a.forceDeallocatePenalty != null ? String(a.forceDeallocatePenalty) : undefined,
  }));
  notes.push("Adapter-level timelocks have no Morpho API field; they are on-chain only.");
  const markets: MarketInfo[] = [];
  for (const item of d.caps?.items ?? []) {
    if (item.type !== "MarketV1" || item.data?.__typename !== "MarketV1CapData") continue;
    const m = item.data.market, mp = item.data.marketParams;
    const id = (m?.marketId ?? mp?.id) as Hex;
    const alloc = BigInt(item.allocation ?? 0);
    const adapterAddr = item.data.adapterAddress ? getAddress(item.data.adapterAddress) : undefined;
    const ad = adapters.find((a) => a.address.toLowerCase() === adapterAddr?.toLowerCase());
    if (ad && !ad.markets.includes(id)) ad.markets.push(id);
    markets.push({
      id, loanToken: addr(mp?.loanToken ?? m?.loanAsset?.address), collateralToken: mp?.collateralToken && mp.collateralToken !== ZERO ? getAddress(mp.collateralToken) : m?.collateralAsset?.address ? getAddress(m.collateralAsset.address) : null,
      oracle: mp?.oracle && mp.oracle !== ZERO ? getAddress(mp.oracle) : m?.oracle?.address ? getAddress(m.oracle.address) : null, irm: mp?.irm ? getAddress(mp.irm) : m?.irmAddress ? getAddress(m.irmAddress) : null,
      lltv: Number(mp?.lltv ?? m?.lltv ?? 0) / 1e18, collateralSymbol: m?.collateralAsset?.symbol, loanSymbol: m?.loanAsset?.symbol,
      supplyAssets: alloc.toString(), supplyAssetsUsd: price !== undefined ? (Number(alloc) / 10 ** dec) * price : undefined,
      cap: { absolute: item.absoluteCap != null ? String(item.absoluteCap) : undefined, relative: item.relativeCap != null ? String(item.relativeCap) : undefined },
      allocation: alloc.toString(), adapter: adapterAddr, oracleType: m?.oracle?.type, morphoBlue: m?.morphoBlue?.address ? getAddress(m.morphoBlue.address) : undefined,
    });
  }
  snap.adapters = adapters; snap.markets = markets;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fillV1(api: MorphoApi, vault: Address, chainId: number, snap: VaultSnapshot, notes: string[]) {
  const d = await api.vaultV1(vault, chainId);
  if (!d) throw new Error("Morpho API has no MetaMorpho vault at this address on this chain");
  const s = d.state ?? {};
  snap.name = d.name; snap.symbol = d.symbol;
  snap.asset = { address: getAddress(d.asset.address), symbol: d.asset.symbol, decimals: Number(d.asset.decimals ?? 0) };
  snap.factory = d.factory?.address ? getAddress(d.factory.address) : undefined; snap.factoryVerified = d.factory?.address ? true : null;
  notes.push("The Morpho API only indexes vaults deployed by the official factories, so being listed here counts as the API-side factory confirmation.");
  snap.owner = addr(s.owner); snap.curator = addr(s.curator); snap.guardian = addr(s.guardian);
  snap.timelockV1 = Number(s.timelock ?? 0);
  snap.fees = { feeV1: num(s.fee), feeRecipientV1: opt(s.feeRecipient), skimRecipient: opt(s.skimRecipient) };
  snap.allocators = (d.allocators ?? []).map((a: { address: string }) => getAddress(a.address));
  snap.totalAssets = s.totalAssets != null ? String(s.totalAssets) : undefined; snap.totalAssetsUsd = num(s.totalAssetsUsd);
  const markets: MarketInfo[] = [];
  for (const al of s.allocation ?? []) {
    const m = al.market;
    markets.push({
      id: m.marketId as Hex, loanToken: addr(m.loanAsset?.address), collateralToken: m.collateralAsset?.address ? getAddress(m.collateralAsset.address) : null,
      oracle: m.oracle?.address ? getAddress(m.oracle.address) : null, irm: m.irmAddress ? getAddress(m.irmAddress) : null, lltv: Number(m.lltv ?? 0) / 1e18,
      collateralSymbol: m.collateralAsset?.symbol, loanSymbol: m.loanAsset?.symbol, supplyAssets: String(al.supplyAssets ?? "0"), supplyAssetsUsd: num(al.supplyAssetsUsd),
      cap: { supplyCap: al.supplyCap != null ? String(al.supplyCap) : undefined, supplyCapUsd: num(al.supplyCapUsd), enabled: al.supplyCap != null && String(al.supplyCap) !== "0" }, oracleType: m.oracle?.type,
      morphoBlue: m.morphoBlue?.address ? getAddress(m.morphoBlue.address) : undefined,
    });
  }
  snap.markets = markets;
  if (snap.allocators.length === 0) notes.push("The API lists no allocators for this v1.1 vault.");
}

const addr = (a: string | null | undefined): Address => (a ? getAddress(a) : ZERO);
const opt = (a: string | null | undefined): Address | undefined => (a ? getAddress(a) : undefined);
const num = (x: unknown): number | undefined => (x === null || x === undefined ? undefined : Number(x));
