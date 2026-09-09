/**
 * Generates config/sky-vaults.json: every Morpho vault on the accepted chains that
 *   - a Prime agent can allocate to (the Prime's RateLimits contract holds a deposit rate limit for it), or
 *   - a Prime ALM proxy holds shares in, or
 *   - a Prime governance address owns, or
 *   - a Prime registry or the Atlas lists, or
 *   - Sky Money (Morpho's curator registry) owns or curates (Skybase's own vaults).
 * Sources: the Morpho API for the vault universe, positions and TVL; the registries for RateLimits, ALM proxies and
 * governance addresses; chain state for the rate limits; the Atlas and the curator registry for the rest.
 * The file is rewritten only when membership, status or sources change; TVL and exposure are a snapshot that the
 * page refreshes live. `--check` exits 1 when membership changed.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getAddress, type Abi } from "viem";
import { loadPolicy, loadProviders, loadLabels, loadEnv, p } from "../src/node/load.ts";
import { MorphoApi } from "../src/sources/morpho-api/client.ts";
import { OnchainReader, httpEndpoint } from "../src/sources/onchain/client.ts";
import { rateLimitsAbi } from "../src/sources/onchain/abis.ts";
import { depositRateLimitKey } from "../src/sources/onchain/vault.ts";

loadEnv();
const policy = loadPolicy(), providers = loadProviders(), labels = loadLabels(policy);
const api = new MorphoApi(providers.morphoApi);
const check = process.argv.includes("--check");
const CHAINS = policy.chains.accepted.map((c) => c.id);
const reg = labels.data.registry?.entries ?? [];
const chainName = (id: number) => providers.chains[String(id)]?.name ?? `chain ${id}`;

export interface SkyVault {
  address: string; chainId: number; chain: string; version: "v2" | "v1.1"; name: string; symbol: string; asset?: string; decimals?: number;
  prime: string; tvlUsd: number; exposureUsd: number; exposureByPrime: Record<string, number>;
  allocatable: { prime: string; contract: string; maxAmount: string; perDay: string }[];
  relations: string[]; sources: string[]; status: string;
}
type U = { address: string; chainId: number; version: "v2" | "v1.1"; name: string; symbol: string; asset?: string; decimals?: number; tvlUsd: number; owner?: string; curator?: string };

async function universe(chainId: number): Promise<U[]> {
  const out: U[] = [];
  for (const [kind, q, pick] of [
    ["v2", "vaultV2s", (v: any): U => ({ address: getAddress(v.address), chainId, version: "v2", name: v.name, symbol: v.symbol, asset: v.asset?.symbol, decimals: v.asset?.decimals, tvlUsd: Number(v.totalAssetsUsd ?? 0), owner: v.owner?.address, curator: v.curator?.address })],
    ["v1.1", "vaults", (v: any): U => ({ address: getAddress(v.address), chainId, version: "v1.1", name: v.name, symbol: v.symbol, asset: v.asset?.symbol, decimals: v.asset?.decimals, tvlUsd: Number(v.state?.totalAssetsUsd ?? 0), owner: v.state?.owner, curator: v.state?.curator })],
  ] as const) {
    for (let skip = 0; ; skip += 500) {
      const fields = kind === "v2" ? "address name symbol asset { symbol decimals } totalAssetsUsd owner { address } curator { address }" : "address name symbol asset { symbol decimals } state { totalAssetsUsd owner curator }";
      const d = await api.gql<any>(`query($c: [Int!], $skip: Int) { r: ${q}(where: { chainId_in: $c }, first: 500, skip: $skip) { items { ${fields} } pageInfo { countTotal } } }`, { c: [chainId], skip });
      for (const v of d.r.items) out.push(pick(v));
      if (skip + 500 >= d.r.pageInfo.countTotal) break;
    }
  }
  return out;
}

const vaults = new Map<string, SkyVault>();
const key = (c: number, a: string) => `${c}:${a.toLowerCase()}`;
const ensure = (u: U): SkyVault => {
  const k = key(u.chainId, u.address);
  if (!vaults.has(k)) vaults.set(k, { address: u.address, chainId: u.chainId, chain: chainName(u.chainId), version: u.version, name: u.name, symbol: u.symbol, asset: u.asset, decimals: u.decimals, prime: "", tvlUsd: Math.round(u.tvlUsd), exposureUsd: 0, exposureByPrime: {}, allocatable: [], relations: [], sources: [], status: "" });
  return vaults.get(k)!;
};
const add = (v: SkyVault, relation: string, source: string) => { if (!v.relations.includes(relation)) v.relations.push(relation); if (!v.sources.includes(source)) v.sources.push(source); };

for (const chainId of CHAINS) {
  const cfg = providers.chains[String(chainId)];
  const all = await universe(chainId);
  const byAddr = new Map(all.map((u) => [u.address.toLowerCase(), u]));
  console.log(`${chainName(chainId)}: ${all.length} Morpho vaults in the API universe`);
  // 1. allocatable: deposit rate limit on a Prime's RateLimits contract
  const reader = new OnchainReader(chainId, cfg.name, cfg.rpc.map(httpEndpoint), providers.multicall3, { pinLag: cfg.pinLag });
  for (const rl of reg.filter((e) => e.role === "almRateLimits" && e.chainId === chainId)) {
    const calls = all.map((u) => ({ key: u.address.toLowerCase(), address: rl.address as `0x${string}`, abi: rateLimitsAbi as Abi, functionName: "getRateLimitData", args: [depositRateLimitKey(u.address as `0x${string}`)] }));
    const res = await reader.read(calls);
    let n = 0;
    for (const u of all) {
      const r = res[u.address.toLowerCase()];
      if (!r?.ok) continue;
      const d = r.value as { maxAmount: bigint; slope: bigint; lastUpdated: bigint };
      if (d.maxAmount === 0n && d.lastUpdated === 0n) continue;
      const v = ensure(u); n++;
      v.allocatable.push({ prime: rl.prime, contract: rl.address, maxAmount: d.maxAmount.toString(), perDay: (d.slope * 86400n).toString() });
      add(v, "allocatable", `${rl.prime} RateLimits ${rl.constant} (${rl.repo} ${rl.file} L${rl.line}) holds a LIMIT_4626_DEPOSIT key for this vault`);
    }
    console.log(`  ${rl.prime} ${rl.constant}: ${n} vaults allocatable (block ${reader.block})`);
  }
  // 2. exposure: ALM proxy positions
  for (const pr of reg.filter((e) => e.role === "almProxy" && e.chainId === chainId)) {
    try {
      const d = await api.gql<any>(`query($a: String!, $c: Int!) { userByAddress(address: $a, chainId: $c) { vaultPositions { vault { address } state { assetsUsd } } vaultV2Positions { vault { address } assetsUsd } } }`, { a: pr.address, c: chainId });
      const pos = [...(d.userByAddress?.vaultPositions ?? []).map((x: any) => ({ a: x.vault.address, usd: Number(x.state?.assetsUsd ?? 0) })), ...(d.userByAddress?.vaultV2Positions ?? []).map((x: any) => ({ a: x.vault.address, usd: Number(x.assetsUsd ?? 0) }))];
      for (const x of pos) {
        if (x.usd < 1) continue;
        const u = byAddr.get(x.a.toLowerCase()); if (!u) continue;
        const v = ensure(u);
        v.exposureByPrime[pr.prime] = Math.round((v.exposureByPrime[pr.prime] ?? 0) + x.usd);
        add(v, "exposure", `${pr.prime} ${pr.constant} holds a position (Morpho API)`);
      }
    } catch (e) { if (!/not found/i.test((e as Error).message)) console.error(`positions ${pr.prime} ${chainId}: ${(e as Error).message.slice(0, 80)}`); }
  }
  // 3. governance and curation from the universe's own owner/curator fields
  const gov = new Map(reg.filter((e) => (e.role === "subproxy" || e.role === "executor") && e.chainId === chainId).map((e) => [e.address.toLowerCase(), e]));
  const cur = new Map(reg.filter((e) => e.role === "morphoCurator" && e.chainId === chainId).map((e) => [e.address.toLowerCase(), e]));
  for (const u of all) {
    const g = u.owner && gov.get(u.owner.toLowerCase()); if (g) add(ensure(u), "owner", `owned by ${g.prime} governance (${g.constant})`);
    const c = u.curator && cur.get(u.curator.toLowerCase()); if (c) add(ensure(u), "curator", `curated by ${c.prime}'s ${c.constant}`);
  }
  // 4. registry vault constants and Atlas token-address mentions
  for (const e of reg.filter((x) => x.role === "morphoVault" && x.chainId === chainId)) { const u = byAddr.get(e.address.toLowerCase()); if (u) add(ensure(u), "registry", `${e.prime} registry ${e.file} L${e.line} ${e.constant}`); }
  for (const m of labels.data.atlas?.entries ?? []) { if (m.roleHint !== "token") continue; const u = byAddr.get(m.address.toLowerCase()); if (u) add(ensure(u), "atlas", `Atlas ${m.article} (${m.prime ?? "?"})`); }
  // 5. Skybase: Sky Money in Morpho's curator registry
  const sky = new Set((labels.data.curators?.entries ?? []).filter((c) => /sky money/i.test(c.name)).flatMap((c) => c.addresses.filter((a) => a.chainId === chainId).map((a) => a.address.toLowerCase())));
  for (const u of all) if ((u.owner && sky.has(u.owner.toLowerCase())) || (u.curator && sky.has(u.curator.toLowerCase()))) { const v = ensure(u); v.prime = "Skybase"; add(v, u.owner && sky.has(u.owner.toLowerCase()) ? "owner" : "curator", "Sky Money in Morpho's curator registry (verified) owns or curates it"); }
}

// primary Prime, exposure total, status
for (const v of vaults.values()) {
  v.exposureUsd = Object.values(v.exposureByPrime).reduce((a, b) => a + b, 0);
  if (!v.prime) {
    const byExp = Object.entries(v.exposureByPrime).sort((a, b) => b[1] - a[1])[0]?.[0];
    const src = (rel: string) => v.sources.find((s) => s.startsWith(rel))?.split(" ")[0];
    v.prime = byExp ?? v.allocatable[0]?.prime ?? (v.sources.find((s) => s.startsWith("owned by "))?.split(" ")[2]) ?? src("Grove") ?? src("Spark") ?? src("Osero") ?? v.sources[0]?.split(" ")[0] ?? "unknown";
  }
  v.status = v.prime === "Skybase" ? "Skybase vault" : v.exposureUsd >= 1 ? "exposure" : v.allocatable.length ? "allocatable, no position" : v.relations.includes("owner") ? "governed, empty" : "listed only";
}
const primes = [...new Set([...vaults.values()].map((v) => v.prime))].sort((a, b) => (a === "Skybase" ? 1 : b === "Skybase" ? -1 : 0) || [...vaults.values()].filter((v) => v.prime === b).reduce((s, v) => s + v.exposureUsd, 0) - [...vaults.values()].filter((v) => v.prime === a).reduce((s, v) => s + v.exposureUsd, 0));
const groups = primes.map((prime) => ({ prime, exposureUsd: [...vaults.values()].filter((v) => v.prime === prime).reduce((s, v) => s + v.exposureUsd, 0), vaults: [...vaults.values()].filter((v) => v.prime === prime).sort((a, b) => b.exposureUsd - a.exposureUsd || b.tvlUsd - a.tvlUsd) }));
const out = {
  note: "Generated by npm run sync:vaults. Membership, status and sources are what the daily sync watches; tvlUsd and exposureUsd are a snapshot that the page refreshes live.",
  definition: "Listed when a Prime's RateLimits contract holds a deposit rate limit for the vault (a Prime agent can allocate to it), a Prime ALM proxy holds shares in it, a Prime governance address owns it, a Prime registry or the Atlas lists it, or Sky Money (Morpho's curator registry) owns or curates it.",
  generatedAt: new Date().toISOString(), chains: CHAINS, count: vaults.size, groups,
};
const material = (o: any) => JSON.stringify((o.groups as any[]).map((g) => ({ prime: g.prime, vaults: g.vaults.map((v: any) => ({ a: v.address, c: v.chainId, s: v.status, r: v.relations, src: v.sources, al: v.allocatable.map((x: any) => x.prime + x.contract) })) })));
const prev = existsSync(p("config/sky-vaults.json")) ? JSON.parse(readFileSync(p("config/sky-vaults.json"), "utf8")) : null;
const changed = !prev || material(prev) !== material(out);
if (!check && (changed || !prev)) writeFileSync(p("config/sky-vaults.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`\n${vaults.size} vaults in ${groups.length} groups: ${groups.map((g) => `${g.prime} ${g.vaults.length} ($${Math.round(g.exposureUsd / 1e6)}M exposure)`).join(", ")}`);
console.log(`config/sky-vaults.json: ${changed ? "CHANGED" : "unchanged (membership, status and sources identical)"}`);
if (check && changed) process.exit(1);
process.exit(changed ? 20 : 0);
