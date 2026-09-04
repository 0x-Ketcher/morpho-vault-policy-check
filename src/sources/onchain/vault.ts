import { keccak256, encodeAbiParameters, toHex, type Abi, getAddress } from "viem";
import type { Address, Hex, VaultSnapshot, VaultVersion, SafeInfo, MarketInfo, AdapterInfo, ExposureInfo, RateLimitData } from "../../core/types.ts";
import { OnchainReader, type Call } from "./client.ts";
import { vaultV2Abi, adapterAbi, metaMorphoAbi, morphoBlueAbi, safeAbi, erc20Abi, rateLimitsAbi, vaultV2FactoryAbi, metaMorphoFactoryAbi, selectorOf } from "./abis.ts";
import type { LabelBook } from "../labels/index.ts";

export interface OnchainHints {
  version?: VaultVersion;
  factory?: Address;
  sentinels?: Address[];
  allocators?: Address[];
  /** (adapter, market id) pairs known to the API; cap-only markets that were never allocated are not enumerable from the adapter */
  markets?: { adapter?: Address; id: Hex }[];
  assetPriceUsd?: number;
}

export interface TimelockPolicyFn { function: string; label: string; minDays?: number; abdicationSatisfies?: boolean }
export interface TimelockPolicy { vault: TimelockPolicyFn[]; adapter: TimelockPolicyFn[]; informational: TimelockPolicyFn[] }

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const WAD = 10n ** 18n;
const V2 = vaultV2Abi as Abi, ADP = adapterAbi as Abi, MM = metaMorphoAbi as Abi, BLUE = morphoBlueAbi as Abi, SAFE = safeAbi as Abi, ERC20 = erc20Abi as Abi, RL = rateLimitsAbi as Abi;

export const depositRateLimitKey = (vault: Address): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [keccak256(toHex("LIMIT_4626_DEPOSIT")), vault]));
export const withdrawRateLimitKey = (vault: Address): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [keccak256(toHex("LIMIT_4626_WITHDRAW")), vault]));

/** Detect the vault version from chain state alone: V2 exposes adaptersLength(), v1.1 exposes guardian() and timelock(). */
export async function detectVersionOnchain(reader: OnchainReader, vault: Address): Promise<VaultVersion | null> {
  const r = await reader.read([
    { key: "v2", address: vault, abi: V2, functionName: "adaptersLength" },
    { key: "v1", address: vault, abi: MM, functionName: "guardian" },
    { key: "v1t", address: vault, abi: MM, functionName: "timelock" },
  ]);
  if (r.v2.ok) return "v2";
  if (r.v1.ok && r.v1t.ok) return "v1.1";
  return null;
}

export async function readVaultOnchain(
  reader: OnchainReader,
  vault: Address,
  hints: OnchainHints,
  labels: LabelBook,
  timelockPolicy: TimelockPolicy,
): Promise<VaultSnapshot> {
  await reader.pin();
  const chainId = reader.chainId;
  const notes: string[] = [];
  const version = hints.version ?? (await detectVersionOnchain(reader, vault));
  if (!version) throw new Error("Neither Vault V2 nor MetaMorpho v1.1 getters answer at this address on this chain");

  const snap: VaultSnapshot = {
    source: "onchain", address: vault, chainId, version, asset: { address: ZERO },
    owner: ZERO, curator: ZERO, guardian: null, sentinels: [], allocators: [], adapters: [], markets: [],
    timelocks: {}, fees: {}, exposure: [], safes: {},
    meta: { block: Number(reader.block), blockTimestamp: reader.blockTimestamp, fetchedAt: new Date().toISOString(), providers: reader.urls, notes },
  };

  const almProxies = labels.byRole("almProxy", chainId);
  const rateLimitContracts = labels.byRole("almRateLimits", chainId);

  if (version === "v2") await readV2(reader, vault, hints, snap, timelockPolicy, almProxies, rateLimitContracts, notes);
  else await readV1(reader, vault, hints, snap, almProxies, rateLimitContracts, notes);

  await readSafes(reader, snap);
  return snap;
}

async function readV2(reader: OnchainReader, vault: Address, hints: OnchainHints, snap: VaultSnapshot, tl: TimelockPolicy, almProxies: { prime: string; address: string; constant: string }[], rlContracts: { prime: string; address: string; constant: string }[], notes: string[]) {
  const c = (key: string, functionName: string, args?: readonly unknown[], address: Address = vault, abi: Abi = V2): Call => ({ key, address, abi, functionName, args });
  const vaultFns = [...tl.vault, ...tl.informational];
  const stage1: Call[] = [
    c("owner", "owner"), c("curator", "curator"), c("asset", "asset"), c("name", "name"), c("symbol", "symbol"), c("decimals", "decimals"),
    c("totalAssets", "totalAssets"), c("performanceFee", "performanceFee"), c("managementFee", "managementFee"),
    c("performanceFeeRecipient", "performanceFeeRecipient"), c("managementFeeRecipient", "managementFeeRecipient"),
    c("adapterRegistry", "adapterRegistry"), c("receiveSharesGate", "receiveSharesGate"), c("sendSharesGate", "sendSharesGate"),
    c("receiveAssetsGate", "receiveAssetsGate"), c("sendAssetsGate", "sendAssetsGate"), c("adaptersLength", "adaptersLength"),
    c("liquidityAdapter", "liquidityAdapter"), c("maxRate", "maxRate"),
    c("abd:setAdapterRegistry(address)", "abdicated", [selectorOf("setAdapterRegistry(address)")]),
    ...vaultFns.map((f) => c(`tl:${f.function}`, "timelock", [selectorOf(f.function)])),
    ...vaultFns.map((f) => c(`abd:${f.function}`, "abdicated", [selectorOf(f.function)])),
    ...(hints.sentinels ?? []).map((s) => c(`isSentinel:${s.toLowerCase()}`, "isSentinel", [s])),
    ...(hints.allocators ?? []).map((a) => c(`isAllocator:${a.toLowerCase()}`, "isAllocator", [a])),
    ...almProxies.map((p) => c(`bal:${p.address.toLowerCase()}`, "balanceOf", [p.address as Address])),
  ];
  if (hints.factory) stage1.push(c("factory", "isVaultV2", [vault], hints.factory, vaultV2FactoryAbi as Abi));
  const r1 = await reader.read(stage1);
  const v = <T>(k: string): T | undefined => (r1[k]?.ok ? (r1[k].value as T) : undefined);

  snap.owner = v<Address>("owner") ?? ZERO;
  snap.curator = v<Address>("curator") ?? ZERO;
  snap.asset = { address: v<Address>("asset") ?? ZERO };
  snap.name = v<string>("name"); snap.symbol = v<string>("symbol");
  snap.totalAssets = v<bigint>("totalAssets")?.toString();
  snap.fees = {
    performanceFee: wadToFraction(v<bigint>("performanceFee")), managementFee: wadToFraction(v<bigint>("managementFee")),
    performanceFeeRecipient: v<Address>("performanceFeeRecipient"), managementFeeRecipient: v<Address>("managementFeeRecipient"),
  };
  snap.adapterRegistry = v<Address>("adapterRegistry");
  snap.adapterRegistryAbdicated = v<boolean>("abd:setAdapterRegistry(address)");
  snap.gates = {};
  for (const g of ["receiveSharesGate", "sendSharesGate", "receiveAssetsGate", "sendAssetsGate"]) {
    const addr = v<Address>(g);
    if (addr !== undefined) snap.gates[g] = { address: addr, abdicated: v<boolean>(`abd:set${g[0].toUpperCase()}${g.slice(1)}(address)`) };
  }
  for (const f of vaultFns) {
    const secs = v<bigint>(`tl:${f.function}`);
    if (secs !== undefined) snap.timelocks[f.function] = { selector: selectorOf(f.function), seconds: Number(secs), abdicated: v<boolean>(`abd:${f.function}`) ?? false };
  }
  if (hints.factory) snap.factory = hints.factory, (snap.factoryVerified = v<boolean>("factory") ?? null);
  for (const s of hints.sentinels ?? []) if (v<boolean>(`isSentinel:${s.toLowerCase()}`)) snap.sentinels.push(getAddress(s));
  for (const a of hints.allocators ?? []) if (v<boolean>(`isAllocator:${a.toLowerCase()}`)) snap.allocators.push(getAddress(a));
  if (!hints.sentinels) notes.push("Sentinels cannot be enumerated from chain state (Vault V2 only exposes isSentinel(address)); candidates come from the Morpho API and are confirmed here one by one.");
  if (!hints.allocators) notes.push("Allocators cannot be enumerated from chain state; candidates come from the Morpho API and are confirmed here one by one.");

  // Stage 2: adapters (enumerated on-chain), asset metadata, ALM positions, rate limits
  const n = Number(v<bigint>("adaptersLength") ?? 0n);
  const stage2: Call[] = [
    ...Array.from({ length: n }, (_, i) => c(`adapter:${i}`, "adapters", [BigInt(i)])),
    c("assetSymbol", "symbol", [], snap.asset.address, ERC20), c("assetDecimals", "decimals", [], snap.asset.address, ERC20),
    ...almProxies.map((p) => c(`assets:${p.address.toLowerCase()}`, "convertToAssets", [v<bigint>(`bal:${p.address.toLowerCase()}`) ?? 0n])),
    ...rlContracts.flatMap((rl) => [
      c(`rl:dep:${rl.address.toLowerCase()}`, "getRateLimitData", [depositRateLimitKey(vault)], rl.address as Address, RL),
      c(`rl:wd:${rl.address.toLowerCase()}`, "getRateLimitData", [withdrawRateLimitKey(vault)], rl.address as Address, RL),
    ]),
  ];
  const r2 = await reader.read(stage2);
  const v2 = <T>(k: string): T | undefined => (r2[k]?.ok ? (r2[k].value as T) : undefined);
  snap.asset.symbol = v2<string>("assetSymbol"); snap.asset.decimals = v2<number>("assetDecimals");
  const adapters = Array.from({ length: n }, (_, i) => v2<Address>(`adapter:${i}`)).filter((a): a is Address => !!a);
  snap.exposure = buildExposure(vault, almProxies, rlContracts, (p) => v<bigint>(`bal:${p}`), (p) => v2<bigint>(`assets:${p}`), (k) => v2<{ maxAmount: bigint; slope: bigint; lastAmount: bigint; lastUpdated: bigint }>(k), snap.asset.decimals, hints.assetPriceUsd, notes);

  // Stage 3: per adapter: market ids, morpho, timelocks, skim recipient; force-deallocate penalty on the vault
  const stage3: Call[] = adapters.flatMap((a) => [
    c(`a:${a}:len`, "marketIdsLength", [], a, ADP), c(`a:${a}:morpho`, "morpho", [], a, ADP), c(`a:${a}:parent`, "parentVault", [], a, ADP),
    c(`a:${a}:skim`, "skimRecipient", [], a, ADP), c(`a:${a}:penalty`, "forceDeallocatePenalty", [a]),
    ...tl.adapter.map((f) => c(`a:${a}:tl:${f.function}`, "timelock", [selectorOf(f.function)], a, ADP)),
    ...tl.adapter.map((f) => c(`a:${a}:abd:${f.function}`, "abdicated", [selectorOf(f.function)], a, ADP)),
  ]);
  const r3 = await reader.read(stage3);
  const v3 = <T>(k: string): T | undefined => (r3[k]?.ok ? (r3[k].value as T) : undefined);
  const adapterInfos: AdapterInfo[] = adapters.map((a) => {
    const info: AdapterInfo = { address: a, markets: [], timelocks: {}, abdicated: {}, skimRecipient: v3<Address>(`a:${a}:skim`), parentVault: v3<Address>(`a:${a}:parent`), morpho: v3<Address>(`a:${a}:morpho`), forceDeallocatePenalty: v3<bigint>(`a:${a}:penalty`)?.toString() };
    if (v3<bigint>(`a:${a}:len`) === undefined) info.type = "unknown (not a MorphoMarketV1 adapter)";
    else info.type = "MorphoMarketV1";
    for (const f of tl.adapter) {
      const s = v3<bigint>(`a:${a}:tl:${f.function}`);
      if (s !== undefined) info.timelocks![f.function] = Number(s), (info.abdicated![f.function] = v3<boolean>(`a:${a}:abd:${f.function}`) ?? false);
    }
    return info;
  });
  snap.adapters = adapterInfos;

  // Stage 4: market ids per adapter
  const stage4: Call[] = adapterInfos.flatMap((a) => {
    const len = Number(v3<bigint>(`a:${a.address}:len`) ?? 0n);
    return Array.from({ length: len }, (_, i) => c(`m:${a.address}:${i}`, "marketIds", [BigInt(i)], a.address, ADP));
  });
  const r4 = await reader.read(stage4);
  for (const a of adapterInfos) {
    const len = Number(v3<bigint>(`a:${a.address}:len`) ?? 0n);
    for (let i = 0; i < len; i++) { const id = r4[`m:${a.address}:${i}`]; if (id?.ok) a.markets.push(id.value as Hex); }
  }
  // Cap-only markets (never allocated) are not in the adapter's list; confirm the API's candidates on-chain via ids() and absoluteCap().
  let hinted = 0;
  for (const h of hints.markets ?? []) {
    const a = adapterInfos.find((x) => x.address.toLowerCase() === h.adapter?.toLowerCase()) ?? (adapterInfos.length === 1 ? adapterInfos[0] : undefined);
    if (!a) continue;
    if (!a.markets.some((m) => m.toLowerCase() === h.id.toLowerCase())) { a.markets.push(h.id); hinted++; }
  }
  if (hinted) notes.push(`${hinted} market(s) listed by the API but not enumerable from the adapter (never allocated); their caps were confirmed on-chain via the adapter's ids() and the vault's absoluteCap().`);

  // Stage 5: market params, market totals and adapter positions from Morpho Blue
  const pairs = adapterInfos.flatMap((a) => a.markets.map((id) => ({ adapter: a, id })));
  const stage5: Call[] = pairs.flatMap(({ adapter, id }) => {
    const blue = adapter.morpho;
    if (!blue) return [];
    return [c(`mp:${id}`, "idToMarketParams", [id], blue, BLUE), c(`mk:${id}`, "market", [id], blue, BLUE), c(`pos:${adapter.address}:${id}`, "position", [id, adapter.address], blue, BLUE)];
  });
  const r5 = await reader.read(stage5);
  const v5 = <T>(k: string): T | undefined => (r5[k]?.ok ? (r5[k].value as T) : undefined);
  // Stage 5b: the vault's cap ids for each market come from the adapter: ids(marketParams) = [adapter id, collateral id, market id]
  const stage5b: Call[] = pairs.flatMap(({ adapter, id }) => {
    const mp = v5<readonly [Address, Address, Address, Address, bigint]>(`mp:${id}`);
    if (!mp) return [];
    return [c(`ids:${adapter.address}:${id}`, "ids", [{ loanToken: mp[0], collateralToken: mp[1], oracle: mp[2], irm: mp[3], lltv: mp[4] }], adapter.address, ADP)];
  });
  const r5b = await reader.read(stage5b);
  const capIdOf = (adapter: Address, id: Hex): Hex | undefined => { const r = r5b[`ids:${adapter}:${id}`]; const ids = r?.ok ? (r.value as Hex[]) : undefined; return ids && ids.length >= 3 ? ids[2] : undefined; };
  // Stage 5c: absolute cap, relative cap and allocation per market cap id
  const stage5c: Call[] = pairs.flatMap(({ adapter, id }) => {
    const cid = capIdOf(adapter.address, id);
    if (!cid) return [];
    return [c(`cap:abs:${cid}`, "absoluteCap", [cid]), c(`cap:rel:${cid}`, "relativeCap", [cid]), c(`alloc:${cid}`, "allocation", [cid])];
  });
  const r5c = await reader.read(stage5c);
  const v5c = <T>(k: string): T | undefined => (r5c[k]?.ok ? (r5c[k].value as T) : undefined);
  const markets: MarketInfo[] = [];
  for (const { adapter, id } of pairs) {
    const mp = v5<readonly [Address, Address, Address, Address, bigint]>(`mp:${id}`);
    const mk = v5<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>(`mk:${id}`);
    const pos = v5<readonly [bigint, bigint, bigint]>(`pos:${adapter.address}:${id}`);
    if (!mp) continue;
    const cid = capIdOf(adapter.address, id);
    const supply = mk && pos && mk[1] > 0n ? (pos[0] * mk[0]) / mk[1] : 0n;
    markets.push({
      id, loanToken: mp[0], collateralToken: mp[1] === ZERO ? null : mp[1], oracle: mp[2] === ZERO ? null : mp[2], irm: mp[3] === ZERO ? null : mp[3],
      lltv: Number(mp[4]) / 1e18, supplyAssets: supply.toString(), supplyAssetsUsd: toUsd(supply, snap.asset.decimals, hints.assetPriceUsd),
      cap: { absolute: cid ? v5c<bigint>(`cap:abs:${cid}`)?.toString() : undefined, relative: cid ? v5c<bigint>(`cap:rel:${cid}`)?.toString() : undefined },
      allocation: cid ? v5c<bigint>(`alloc:${cid}`)?.toString() : undefined, adapter: adapter.address, morphoBlue: adapter.morpho,
    });
  }
  if (pairs.length && pairs.some(({ adapter, id }) => !capIdOf(adapter.address, id))) notes.push("Some market cap ids could not be derived from the adapter (ids() did not answer); caps for those markets are API-only.");
  // Stage 6: collateral symbols
  const collaterals = [...new Set(markets.map((m) => m.collateralToken).filter((x): x is Address => !!x))];
  const r6 = await reader.read(collaterals.map((t) => c(`sym:${t}`, "symbol", [], t, ERC20)));
  for (const m of markets) if (m.collateralToken && r6[`sym:${m.collateralToken}`]?.ok) m.collateralSymbol = r6[`sym:${m.collateralToken}`].value as string;
  for (const m of markets) m.loanSymbol = m.loanToken.toLowerCase() === snap.asset.address.toLowerCase() ? snap.asset.symbol : undefined;
  snap.markets = markets;
  if (hints.assetPriceUsd === undefined) notes.push("USD values need an asset price; none was provided to the on-chain reader, so USD columns come from the API side only.");
}

async function readV1(reader: OnchainReader, vault: Address, hints: OnchainHints, snap: VaultSnapshot, almProxies: { prime: string; address: string; constant: string }[], rlContracts: { prime: string; address: string; constant: string }[], notes: string[]) {
  const c = (key: string, functionName: string, args?: readonly unknown[], address: Address = vault, abi: Abi = MM): Call => ({ key, address, abi, functionName, args });
  const stage1: Call[] = [
    c("owner", "owner"), c("curator", "curator"), c("guardian", "guardian"), c("timelock", "timelock"), c("fee", "fee"), c("feeRecipient", "feeRecipient"),
    c("skimRecipient", "skimRecipient"), c("asset", "asset"), c("MORPHO", "MORPHO"), c("name", "name"), c("symbol", "symbol"), c("totalAssets", "totalAssets"),
    c("supplyQueueLength", "supplyQueueLength"), c("withdrawQueueLength", "withdrawQueueLength"),
    ...(hints.allocators ?? []).map((a) => c(`isAllocator:${a.toLowerCase()}`, "isAllocator", [a])),
    ...almProxies.map((p) => c(`bal:${p.address.toLowerCase()}`, "balanceOf", [p.address as Address])),
  ];
  if (hints.factory) stage1.push(c("factory", "isMetaMorpho", [vault], hints.factory, metaMorphoFactoryAbi as Abi));
  const r1 = await reader.read(stage1);
  const v = <T>(k: string): T | undefined => (r1[k]?.ok ? (r1[k].value as T) : undefined);
  snap.owner = v<Address>("owner") ?? ZERO; snap.curator = v<Address>("curator") ?? ZERO; snap.guardian = v<Address>("guardian") ?? ZERO;
  snap.timelockV1 = Number(v<bigint>("timelock") ?? 0n);
  snap.fees = { feeV1: wadToFraction(v<bigint>("fee")), feeRecipientV1: v<Address>("feeRecipient"), skimRecipient: v<Address>("skimRecipient") };
  snap.asset = { address: v<Address>("asset") ?? ZERO }; snap.name = v<string>("name"); snap.symbol = v<string>("symbol");
  snap.totalAssets = v<bigint>("totalAssets")?.toString();
  if (hints.factory) snap.factory = hints.factory, (snap.factoryVerified = v<boolean>("factory") ?? null);
  for (const a of hints.allocators ?? []) if (v<boolean>(`isAllocator:${a.toLowerCase()}`)) snap.allocators.push(getAddress(a));
  if (!hints.allocators) notes.push("Allocators cannot be enumerated from chain state; candidates come from the Morpho API and are confirmed here one by one.");
  const blue = v<Address>("MORPHO");
  const sq = Number(v<bigint>("supplyQueueLength") ?? 0n), wq = Number(v<bigint>("withdrawQueueLength") ?? 0n);
  const stage2: Call[] = [
    ...Array.from({ length: sq }, (_, i) => c(`sq:${i}`, "supplyQueue", [BigInt(i)])),
    ...Array.from({ length: wq }, (_, i) => c(`wq:${i}`, "withdrawQueue", [BigInt(i)])),
    c("assetSymbol", "symbol", [], snap.asset.address, ERC20), c("assetDecimals", "decimals", [], snap.asset.address, ERC20),
    ...almProxies.map((p) => c(`assets:${p.address.toLowerCase()}`, "convertToAssets", [v<bigint>(`bal:${p.address.toLowerCase()}`) ?? 0n])),
    ...rlContracts.flatMap((rl) => [
      c(`rl:dep:${rl.address.toLowerCase()}`, "getRateLimitData", [depositRateLimitKey(vault)], rl.address as Address, RL),
      c(`rl:wd:${rl.address.toLowerCase()}`, "getRateLimitData", [withdrawRateLimitKey(vault)], rl.address as Address, RL),
    ]),
  ];
  const r2 = await reader.read(stage2);
  const v2 = <T>(k: string): T | undefined => (r2[k]?.ok ? (r2[k].value as T) : undefined);
  snap.asset.symbol = v2<string>("assetSymbol"); snap.asset.decimals = v2<number>("assetDecimals");
  snap.exposure = buildExposure(vault, almProxies, rlContracts, (p) => v<bigint>(`bal:${p}`), (p) => v2<bigint>(`assets:${p}`), (k) => v2<{ maxAmount: bigint; slope: bigint; lastAmount: bigint; lastUpdated: bigint }>(k), snap.asset.decimals, hints.assetPriceUsd, notes);
  const ids = [...new Set([...Array.from({ length: sq }, (_, i) => v2<Hex>(`sq:${i}`)), ...Array.from({ length: wq }, (_, i) => v2<Hex>(`wq:${i}`))].filter((x): x is Hex => !!x))];
  if (!blue) { notes.push("MORPHO() did not answer; market data unavailable on-chain."); return; }
  const stage3: Call[] = ids.flatMap((id) => [
    c(`mp:${id}`, "idToMarketParams", [id], blue, BLUE), c(`mk:${id}`, "market", [id], blue, BLUE), c(`pos:${id}`, "position", [id, vault], blue, BLUE), c(`cfg:${id}`, "config", [id]),
  ]);
  const r3 = await reader.read(stage3);
  const v3 = <T>(k: string): T | undefined => (r3[k]?.ok ? (r3[k].value as T) : undefined);
  const markets: MarketInfo[] = [];
  for (const id of ids) {
    const mp = v3<readonly [Address, Address, Address, Address, bigint]>(`mp:${id}`);
    const mk = v3<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>(`mk:${id}`);
    const pos = v3<readonly [bigint, bigint, bigint]>(`pos:${id}`);
    const cfg = v3<readonly [bigint, boolean, bigint]>(`cfg:${id}`);
    if (!mp) continue;
    const supply = mk && pos && mk[1] > 0n ? (pos[0] * mk[0]) / mk[1] : 0n;
    markets.push({
      id, loanToken: mp[0], collateralToken: mp[1] === ZERO ? null : mp[1], oracle: mp[2] === ZERO ? null : mp[2], irm: mp[3] === ZERO ? null : mp[3],
      lltv: Number(mp[4]) / 1e18, supplyAssets: supply.toString(), supplyAssetsUsd: toUsd(supply, snap.asset.decimals, hints.assetPriceUsd),
      cap: { supplyCap: cfg?.[0]?.toString(), enabled: cfg?.[1] }, morphoBlue: blue,
    });
  }
  const collaterals = [...new Set(markets.map((m) => m.collateralToken).filter((x): x is Address => !!x))];
  const r4 = await reader.read(collaterals.map((t) => c(`sym:${t}`, "symbol", [], t, ERC20)));
  for (const m of markets) if (m.collateralToken && r4[`sym:${m.collateralToken}`]?.ok) m.collateralSymbol = r4[`sym:${m.collateralToken}`].value as string;
  snap.markets = markets;
}

function buildExposure(
  vault: Address, almProxies: { prime: string; address: string; constant: string }[], rlContracts: { prime: string; address: string; constant: string }[],
  bal: (p: string) => bigint | undefined, assets: (p: string) => bigint | undefined, rl: (k: string) => { maxAmount: bigint; slope: bigint; lastAmount: bigint; lastUpdated: bigint } | undefined,
  decimals: number | undefined, priceUsd: number | undefined, notes: string[],
): ExposureInfo[] {
  const out: ExposureInfo[] = [];
  for (const p of almProxies) {
    const key = p.address.toLowerCase();
    const shares = bal(key) ?? 0n, a = assets(key) ?? 0n;
    const e: ExposureInfo = { prime: p.prime, almProxy: p.address as Address, almProxyLabel: p.constant, shares: shares.toString(), assets: a.toString(), assetsUsd: toUsd(a, decimals, priceUsd) };
    const rlc = rlContracts.find((r) => r.prime === p.prime);
    if (rlc) {
      const dep = rl(`rl:dep:${rlc.address.toLowerCase()}`), wd = rl(`rl:wd:${rlc.address.toLowerCase()}`);
      const conv = (d?: { maxAmount: bigint; slope: bigint; lastAmount: bigint; lastUpdated: bigint }): RateLimitData | null => d ? { maxAmount: d.maxAmount.toString(), slope: d.slope.toString(), lastAmount: d.lastAmount.toString(), lastUpdated: Number(d.lastUpdated) } : null;
      const d = conv(dep), w = conv(wd);
      e.rateLimits = { contract: rlc.address as Address, label: rlc.constant, depositKey: depositRateLimitKey(vault), deposit: d, withdrawKey: withdrawRateLimitKey(vault), withdraw: w, onboarded: !!d && (d.maxAmount !== "0" || d.lastUpdated > 0) };
    }
    out.push(e);
  }
  if (almProxies.length === 0) notes.push("No Prime ALM proxy is labeled in the registries for this chain; Sky exposure not computed.");
  return out;
}

/** Safe structure for every role address (owner, curator, guardian, sentinels, allocators) plus one level of nested Safes. */
async function readSafes(reader: OnchainReader, snap: VaultSnapshot) {
  const roleAddrs = [...new Set([snap.owner, snap.curator, snap.guardian ?? ZERO, ...snap.sentinels, ...snap.allocators].filter((a) => a && a !== ZERO))] as Address[];
  const level1 = await readSafeLevel(reader, roleAddrs);
  const nested = [...new Set(Object.values(level1).flatMap((s) => (s.isSafe ? s.owners ?? [] : [])))].filter((a) => !level1[a.toLowerCase()]);
  const level2 = await readSafeLevel(reader, nested);
  for (const s of Object.values(level1)) {
    if (!s.isSafe) continue;
    s.ownerSafes = {};
    for (const o of s.owners ?? []) { const n = level2[o.toLowerCase()] ?? level1[o.toLowerCase()]; if (n) s.ownerSafes[o.toLowerCase()] = n; }
  }
  snap.safes = { ...level2, ...level1 };
}

async function readSafeLevel(reader: OnchainReader, addrs: Address[]): Promise<Record<string, SafeInfo>> {
  const out: Record<string, SafeInfo> = {};
  if (addrs.length === 0) return out;
  const code = await reader.getCode(addrs);
  const contracts = addrs.filter((a) => code[a.toLowerCase()]);
  for (const a of addrs) if (!code[a.toLowerCase()]) out[a.toLowerCase()] = { address: a, isContract: false, isSafe: false, source: "onchain" };
  const r = await reader.read(contracts.flatMap((a) => [
    { key: `o:${a}`, address: a, abi: SAFE, functionName: "getOwners" }, { key: `t:${a}`, address: a, abi: SAFE, functionName: "getThreshold" }, { key: `v:${a}`, address: a, abi: SAFE, functionName: "VERSION" },
  ]));
  for (const a of contracts) {
    const owners = r[`o:${a}`]?.ok ? (r[`o:${a}`].value as Address[]) : undefined;
    const threshold = r[`t:${a}`]?.ok ? Number(r[`t:${a}`].value as bigint) : undefined;
    out[a.toLowerCase()] = owners && threshold !== undefined
      ? { address: a, isContract: true, isSafe: true, owners: owners.map((o) => getAddress(o)), threshold, version: r[`v:${a}`]?.ok ? (r[`v:${a}`].value as string) : undefined, source: "onchain" }
      : { address: a, isContract: true, isSafe: false, source: "onchain" };
  }
  return out;
}

const wadToFraction = (x?: bigint) => (x === undefined ? undefined : Number((x * 1_000_000n) / WAD) / 1_000_000);
const toUsd = (raw: bigint, decimals?: number, price?: number) => (decimals === undefined || price === undefined ? undefined : (Number(raw) / 10 ** decimals) * price);
