import { providers, labels } from "./data.ts";
import type { SkyVault } from "./data.ts";

type Group = { prime: string; exposureUsd: number; vaults: SkyVault[] };
const API = providers.morphoApi;
const gql = async (query: string, variables: Record<string, unknown>) => {
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const b = (await r.json()) as { data?: any; errors?: { message: string }[] };
  if (b.errors?.length) throw new Error(b.errors[0].message);
  return b.data;
};

/** Refreshes TVL and Prime exposure for the listed vaults from the Morpho API, keeping the committed snapshot as the fallback. */
export async function refreshVaultNumbers(groups: Group[]): Promise<Group[]> {
  const all = groups.flatMap((g) => g.vaults);
  const addrs = [...new Set(all.map((v) => v.address))];
  const d = await gql(`query($a: [String!]) { v2: vaultV2s(where: { address_in: $a }) { items { address chain { id } totalAssetsUsd } } v1: vaults(where: { address_in: $a }) { items { address chain { id } state { totalAssetsUsd } } } }`, { a: addrs });
  const tvl = new Map<string, number>();
  for (const v of d.v2.items) tvl.set(`${v.chain.id}:${v.address.toLowerCase()}`, Number(v.totalAssetsUsd ?? 0));
  for (const v of d.v1.items) tvl.set(`${v.chain.id}:${v.address.toLowerCase()}`, Number(v.state?.totalAssetsUsd ?? 0));
  const exposure = new Map<string, Record<string, number>>();
  const proxies = (labels.data.registry?.entries ?? []).filter((e) => e.role === "almProxy");
  await Promise.all(proxies.map(async (p) => {
    try {
      const r = await gql(`query($a: String!, $c: Int!) { userByAddress(address: $a, chainId: $c) { vaultPositions { vault { address } state { assetsUsd } } vaultV2Positions { vault { address } assetsUsd } } }`, { a: p.address, c: p.chainId });
      const pos = [...(r.userByAddress?.vaultPositions ?? []).map((x: any) => ({ a: x.vault.address, usd: Number(x.state?.assetsUsd ?? 0) })), ...(r.userByAddress?.vaultV2Positions ?? []).map((x: any) => ({ a: x.vault.address, usd: Number(x.assetsUsd ?? 0) }))];
      for (const x of pos) { const k = `${p.chainId}:${x.a.toLowerCase()}`; const e = exposure.get(k) ?? {}; e[p.prime] = (e[p.prime] ?? 0) + x.usd; exposure.set(k, e); }
    } catch { /* unknown user: no positions */ }
  }));
  const fresh = groups.map((g) => ({
    ...g,
    vaults: g.vaults.map((v) => {
      const k = `${v.chainId}:${v.address.toLowerCase()}`;
      const byPrime = exposure.get(k) ?? {};
      const exp = Object.values(byPrime).reduce((s, x) => s + x, 0);
      return { ...v, tvlUsd: tvl.get(k) ?? v.tvlUsd, exposureUsd: exposure.size ? Math.round(exp) : v.exposureUsd, exposureByPrime: exposure.size ? byPrime : v.exposureByPrime };
    }).sort((a, b) => (g.prime === "Skybase" ? b.tvlUsd - a.tvlUsd : b.exposureUsd - a.exposureUsd || b.tvlUsd - a.tvlUsd)),
  }));
  for (const g of fresh) g.exposureUsd = g.vaults.reduce((s, v) => s + v.exposureUsd, 0);
  return fresh.sort((a, b) => (a.prime === "Skybase" ? 1 : b.prime === "Skybase" ? -1 : b.exposureUsd - a.exposureUsd));
}
