/**
 * Reads the structure of every Safe the tool knows about (registry multisigs, Morpho curator addresses, Atlas role
 * addresses, fixture role addresses) on-chain and via the Safe Transaction Service, and writes labels/safes.json.
 * This is the data behind docs/SAFES.md and behind the signer-overlap attribution in the checks.
 */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { getAddress, type Abi } from "viem";
import { loadJson, loadPolicy, loadProviders, loadLabels, loadEnv, p } from "../src/node/load.ts";
import { OnchainReader, httpEndpoint } from "../src/sources/onchain/client.ts";
import { safeAbi } from "../src/sources/onchain/abis.ts";
import { fetchSafe } from "../src/sources/safe/service.ts";
import type { SafeOwnersEntry } from "../src/sources/labels/index.ts";

loadEnv();
const policy = loadPolicy(), providers = loadProviders(), labels = loadLabels(policy);
const CHAINS = [1, 8453, 4663];
const candidates = new Map<string, Set<number>>();
const add = (a: string, chainId?: number) => { const k = getAddress(a); if (!candidates.has(k)) candidates.set(k, new Set()); for (const c of chainId !== undefined ? [chainId] : CHAINS) candidates.get(k)!.add(c); };
for (const e of labels.data.registry?.entries ?? []) if (["morphoCurator", "morphoGuardian", "multisig", "oeaOperator"].includes(e.role)) add(e.address, e.chainId);
for (const c of labels.data.curators?.entries ?? []) for (const a of c.addresses) if (CHAINS.includes(a.chainId)) add(a.address, a.chainId);
for (const e of labels.data.atlas?.entries ?? []) if (e.roleHint && ["curator", "guardian", "sentinel", "allocator", "owner", "multisig"].includes(e.roleHint)) add(e.address);
const fx = loadJson<{ groups: { chain: string; roles: { addresses: string[] }[] }[] }>("tests/fixtures/golden_vault_roles.json").groups;
const chainOf: Record<string, number> = { Ethereum: 1, Base: 8453, "Robinhood Chain": 4663 };
for (const g of fx) for (const r of g.roles) for (const a of r.addresses) add(a, chainOf[g.chain]);

const entries: SafeOwnersEntry[] = [];
for (const chainId of CHAINS) {
  const cfg = providers.chains[String(chainId)];
  const reader = new OnchainReader(chainId, cfg.name, cfg.rpc.map(httpEndpoint), providers.multicall3, { pinLag: cfg.pinLag });
  await reader.pin();
  const addrs = [...candidates.entries()].filter(([, cs]) => cs.has(chainId)).map(([a]) => a as `0x${string}`);
  const code = await reader.getCode(addrs);
  const contracts = addrs.filter((a) => code[a.toLowerCase()]);
  const r = await reader.read(contracts.flatMap((a) => [
    { key: `o:${a}`, address: a, abi: safeAbi as Abi, functionName: "getOwners" }, { key: `t:${a}`, address: a, abi: safeAbi as Abi, functionName: "getThreshold" }, { key: `v:${a}`, address: a, abi: safeAbi as Abi, functionName: "VERSION" },
  ]));
  let safes = 0;
  for (const a of contracts) {
    if (!r[`o:${a}`]?.ok) continue;
    const owners = (r[`o:${a}`].value as string[]).map((o) => getAddress(o));
    const threshold = Number(r[`t:${a}`].value as bigint);
    const svc = await fetchSafe(providers.safeTxService[String(chainId)], a);
    const serviceAgrees = svc === "unavailable" || svc === null ? null : svc.threshold === threshold && svc.owners.map((o) => o.toLowerCase()).sort().join() === owners.map((o) => o.toLowerCase()).sort().join();
    const att = labels.attribute(a, chainId);
    entries.push({ address: a, chainId, isSafe: true, threshold, owners, version: r[`v:${a}`]?.ok ? (r[`v:${a}`].value as string) : undefined, block: Number(reader.block), readAt: new Date().toISOString(), serviceAgrees, label: att.entity ? `${att.entity}${att.roles.length ? ` (${att.roles.join(", ")})` : ""}` : undefined });
    safes++;
  }
  await reader.finish();
  console.log(`chain ${chainId}: ${addrs.length} candidates, ${contracts.length} contracts, ${safes} Safes, block ${reader.block}`);
}
entries.sort((x, y) => x.chainId - y.chainId || x.address.localeCompare(y.address));
const material = (list: SafeOwnersEntry[]) => JSON.stringify(list.map(({ readAt: _r, block: _b, ...rest }) => rest));
const prev = existsSync(p("labels/safes.json")) ? (JSON.parse(readFileSync(p("labels/safes.json"), "utf8")) as { entries: SafeOwnersEntry[] }).entries : [];
const changed = material(prev) !== material(entries);
if (changed || !prev.length) writeFileSync(p("labels/safes.json"), JSON.stringify({ meta: { generatedAt: new Date().toISOString(), chains: CHAINS, count: entries.length }, entries }, null, 1) + "\n");
console.log(`labels/safes.json: ${entries.length} Safes, ${changed ? "CHANGED" : "unchanged (owners, thresholds and labels identical; file left as is)"}`);
