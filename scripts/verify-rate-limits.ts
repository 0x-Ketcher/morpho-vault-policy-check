/**
 * Independent cross-check of the Sky vault list. The list derives rate-limit keys from the Morpho API's vaults and
 * asks the Prime contracts about each one. This script starts from the contracts instead: every RateLimitDataSet
 * event a Prime rate-limit contract ever emitted gives the complete set of keys ever configured; each key is read
 * live; each live key is matched against keys computed for every Morpho vault on every chain the API indexes, every
 * registry address, every token or counterparty the Prime ALM proxies ever transacted with, and every key prefix
 * found in the controllers' verified source code, in each encoding the controllers use. A second vault universe comes
 * from the Morpho factories' own creation events, confirmed by the factory contract, so a vault the API does not index
 * cannot hide, and Prime proxy holdings in such vaults are read from the vaults themselves. "Live" means a non-zero
 * maximum: a key zeroed by a later spell is an offboarding and is reported as such. A live LIMIT_4626_DEPOSIT key for
 * a Morpho vault that the list does not carry fails the run; live keys nothing explains are printed for a human.
 * Sources: Etherscan logs and verified-source APIs (chains it covers), Blockscout logs API on Base and Optimism
 * (Etherscan serves no logs there on the free plan), the official Robinhood node for Robinhood logs, public nodes for
 * current values, the Morpho API for the vault universe, the registries for contracts and addresses.
 */
import { keccak256, encodeAbiParameters, toHex, getAddress, parseAbi, type Abi } from "viem";
import { loadPolicy, loadProviders, loadLabels, loadSkyVaults, loadEnv } from "../src/node/load.ts";
import { MorphoApi } from "../src/sources/morpho-api/client.ts";
import { rateLimitsAbi, vaultV2FactoryAbi, metaMorphoFactoryAbi } from "../src/sources/onchain/abis.ts";
import { makeReader, ETHERSCAN_MORPHO_CHAINS } from "../src/pipeline.ts";

loadEnv();
const policy = loadPolicy(), providers = loadProviders(), labels = loadLabels(policy), sky = loadSkyVaults();
const api = new MorphoApi(providers.morphoApi);
const key = process.env.ETHERSCAN_API_KEY;
if (!key) throw new Error("ETHERSCAN_API_KEY is needed for the logs and verified-source APIs");
const deps = { policy, providers, labels, api, etherscan: { base: providers.etherscan.api, apiKey: key, chains: ETHERSCAN_MORPHO_CHAINS } };
const reg = labels.data.registry!.entries;
const TOPIC = keccak256(toHex("RateLimitDataSet(bytes32,uint256,uint256,uint256,uint256)"));
/** Prefixes known from earlier controller versions; the verified sources below extend the set at run time. */
const STATIC_PREFIXES = ["LIMIT_4626_DEPOSIT", "LIMIT_4626_WITHDRAW", "LIMIT_7540_DEPOSIT", "LIMIT_7540_REDEEM", "LIMIT_AAVE_DEPOSIT", "LIMIT_AAVE_WITHDRAW", "LIMIT_ASSET_TRANSFER", "LIMIT_USDS_MINT", "LIMIT_USDS_TO_USDC", "LIMIT_USDC_TO_CCTP", "LIMIT_USDC_TO_DOMAIN", "LIMIT_BUIDL_REDEEM_CIRCLE", "LIMIT_CURVE_DEPOSIT", "LIMIT_CURVE_SWAP", "LIMIT_CURVE_WITHDRAW", "LIMIT_MAPLE_REDEEM", "LIMIT_SUPERSTATE_REDEEM", "LIMIT_SUPERSTATE_SUBSCRIBE", "LIMIT_SUSDE_COOLDOWN", "LIMIT_USDE_BURN", "LIMIT_USDE_MINT", "LIMIT_LAYERZERO_TRANSFER", "LIMIT_PSM_DEPOSIT", "LIMIT_PSM_WITHDRAW", "LIMIT_SPARK_VAULT_TAKE", "LIMIT_CENTRIFUGE_DEPOSIT", "LIMIT_CENTRIFUGE_REDEEM", "LIMIT_CENTRIFUGE_TRANSFER", "LIMIT_FARM_DEPOSIT", "LIMIT_FARM_WITHDRAW", "LIMIT_UNISWAP_V3_DEPOSIT", "LIMIT_UNISWAP_V3_WITHDRAW", "LIMIT_UNISWAP_V3_SWAP", "LIMIT_PENDLE_DEPOSIT", "LIMIT_PENDLE_WITHDRAW", "LIMIT_PENDLE_PT_REDEEM", "LIMIT_ETHENA_DEPOSIT", "LIMIT_BLACKROCK_BUIDL_DEPOSIT", "LIMIT_BLACKROCK_BUIDL_REDEEM", "LIMIT_MORPHO_DEPOSIT", "LIMIT_MORPHO_WITHDRAW", "LIMIT_WEETH_REQUEST_WITHDRAW"];
const MORPHO_CHAINS: number[] = providers.morphoChains.ids;
const only = process.argv.find((a) => a.startsWith("--chains="))?.slice(9).split(",").map(Number); // e.g. --chains=8453,10 to rerun a subset
const inScope = (chainId: number) => MORPHO_CHAINS.includes(chainId) && (!only || only.includes(chainId));
const gaps: string[] = []; // contracts whose keys could not be enumerated: the run then proves nothing about them
const EXPLORER_CHAINS = [1, 8453, 10, 130, 42161]; // chains with a logs, token-transfer and verified-source API used here
const ETHERSCAN_CHAINS = [1, 130, 42161]; // Etherscan serves logs and token transfers here on the free plan; Base and Optimism go through Blockscout
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const erc4626Abi = parseAbi(["function balanceOf(address) view returns (uint256)", "function name() view returns (string)", "function decimals() view returns (uint8)"]);
const lower = (a: string) => a.toLowerCase();

// ---------------------------------------------------------------- explorer access
type Log = { topics: string[] };
type Topic = `0x${string}` | null; // null: no topic filter
async function etherscanGet(chainId: number, params: string): Promise<unknown> {
  await sleep(400);
  const r = (await (await fetch(`${providers.etherscan.api}?chainid=${chainId}&${params}&apikey=${key}`)).json()) as { result: unknown };
  return r.result;
}
async function etherscanLogs(chainId: number, address: string, topic0: Topic): Promise<Log[]> {
  const logs: Log[] = [];
  for (let page = 1; page < 50; page++) {
    const result = await etherscanGet(chainId, `module=logs&action=getLogs&address=${address}${topic0 ? `&topic0=${topic0}` : ""}&fromBlock=0&toBlock=latest&page=${page}&offset=1000`);
    if (typeof result === "string") { if (/No records/i.test(result)) break; throw new Error(`etherscan logs chain ${chainId}: ${result}`); }
    logs.push(...(result as Log[]));
    if ((result as Log[]).length < 1000) break;
  }
  return logs;
}
async function rpcLogs(url: string, address: string, topic0: Topic): Promise<Log[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(3000 * attempt);
    const body = { jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ address, ...(topic0 ? { topics: [topic0] } : {}), fromBlock: "0x0", toBlock: "latest" }] };
    const r = (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json().catch(() => ({}))) as { result?: Log[]; error?: { message: string } };
    if (r.result) return r.result;
    if (attempt === 3) throw new Error(`rpc logs ${url}: ${r.error?.message ?? "no result"}`);
  }
  return [];
}
/** Keyless Blockscout call; the public limit is low, so a "Too many requests" answer is retried after a pause. */
async function blockscoutGet<R>(url: string): Promise<{ message?: string; result: R | string | null }> {
  for (let attempt = 0; ; attempt++) {
    await sleep(attempt ? 15000 : 1200);
    const r = (await (await fetch(url)).json()) as { message?: string; result: R | string | null };
    if (!/Too many requests/i.test(r.message ?? "") || attempt === 3) return r;
  }
}
/** Blockscout's logs API. Caps at 1000 records, so a full page is bisected by block range. */
async function blockscoutLogs(base: string, address: string, topic0: Topic, from = 0, to: number | "latest" = "latest"): Promise<Log[]> {
  const r = await blockscoutGet<(Log & { blockNumber: string })[]>(`${base}/api?module=logs&action=getLogs&address=${address}${topic0 ? `&topic0=${topic0}` : ""}&fromBlock=${from}&toBlock=${to}`);
  if (r.result == null || typeof r.result === "string") { if (/No (records|logs)/i.test(`${r.message} ${r.result}`)) return []; throw new Error(`blockscout logs: ${r.message ?? r.result}`); }
  if (r.result.length < 1000) return r.result;
  const hi = to === "latest" ? Math.max(...r.result.map((l) => Number(l.blockNumber))) * 2 : to;
  const mid = Math.floor((from + hi) / 2);
  return [...(await blockscoutLogs(base, address, topic0, from, mid)), ...(await blockscoutLogs(base, address, topic0, mid + 1, hi))];
}
const BLOCKSCOUT: Record<number, string> = { 8453: "https://base.blockscout.com", 10: "https://explorer.optimism.io" };
function fetchLogs(chainId: number, address: string, topic0: Topic): Promise<Log[]> {
  if (chainId === 4663) return rpcLogs("https://rpc.mainnet.chain.robinhood.com", address, topic0);
  if (BLOCKSCOUT[chainId]) return blockscoutLogs(BLOCKSCOUT[chainId], address, topic0);
  return etherscanLogs(chainId, address, topic0);
}
type Tx = { contractAddress: string; from: string; to: string };
async function tokenTransfers(chainId: number, address: string): Promise<Tx[]> {
  const result = await etherscanGet(chainId, `module=account&action=tokentx&address=${address}&page=1&offset=10000&sort=asc`);
  if (typeof result === "string") { if (/No transactions/i.test(result)) return []; throw new Error(result); }
  return result as Tx[];
}
async function verifiedSource(chainId: number, address: string): Promise<string> {
  const result = (await etherscanGet(chainId, `module=contract&action=getsourcecode&address=${address}`)) as { SourceCode?: string }[] | string;
  if (typeof result === "string" || !result[0]?.SourceCode) throw new Error(`no verified source (${typeof result === "string" ? result : "empty"})`);
  return result[0].SourceCode;
}

// ---------------------------------------------------------------- candidate addresses
const candidates = new Map<string, string>(); // address -> description
const factories = new Map<number, Map<string, "v1" | "v2">>(); // chain -> factory -> kind
for (const chainId of MORPHO_CHAINS) {
  for (const [q, kind] of [["vaultV2s", "v2"], ["vaults", "v1"]] as const) {
    for (let skip = 0; ; skip += 500) {
      const d = await api.gql<any>(`query($c: [Int!], $skip: Int) { r: ${q}(where: { chainId_in: $c }, first: 500, skip: $skip) { items { address name chain { id } factory { address } } pageInfo { countTotal } } }`, { c: [chainId], skip });
      for (const v of d.r.items) {
        candidates.set(lower(v.address), `Morpho vault "${v.name}" (chain ${v.chain.id})`);
        if (v.factory?.address) (factories.get(chainId) ?? factories.set(chainId, new Map()).get(chainId)!).set(lower(v.factory.address), kind);
      }
      if (skip + 500 >= d.r.pageInfo.countTotal) break;
    }
  }
}
const morphoCount = candidates.size;
for (const e of reg) if (!candidates.has(lower(e.address))) candidates.set(lower(e.address), `${e.prime} registry ${e.constant} (chain ${e.chainId})`);
const regCount = candidates.size - morphoCount;
const counterparties = new Set<string>();
// Blockscout's public limit is about ten calls per window, so its chains skip this optional step and keep the budget for logs.
for (const e of reg.filter((e) => e.role === "almProxy" && ETHERSCAN_CHAINS.includes(e.chainId) && inScope(e.chainId))) {
  try {
    for (const t of await tokenTransfers(e.chainId, e.address)) for (const a of [t.contractAddress, t.from, t.to]) {
      if (!candidates.has(lower(a))) { candidates.set(lower(a), `counterparty of ${e.prime} ${e.constant} (chain ${e.chainId})`); counterparties.add(lower(a)); }
    }
  } catch (err) { console.log(`token transfers unavailable for ${e.prime} ${e.constant} chain ${e.chainId}: ${(err as Error).message.slice(0, 80)}`); }
}
console.log(`candidates: ${morphoCount} Morpho vaults across ${MORPHO_CHAINS.length} chains + ${regCount} registry addresses + ${counterparties.size} proxy counterparties`);

// ---------------------------------------------------------------- key prefixes from the controllers' verified sources
const prefixes = new Set(STATIC_PREFIXES);
const discovered = new Set<string>();
for (const c of reg.filter((e) => e.role === "almController" && EXPLORER_CHAINS.includes(e.chainId))) {
  try {
    for (const p of await verifiedSource(c.chainId, c.address).then((s) => s.match(/LIMIT_[A-Z0-9_]+/g) ?? [])) { if (!prefixes.has(p)) discovered.add(p); prefixes.add(p); }
  } catch (err) { console.log(`verified source unavailable for ${c.prime} ${c.constant} chain ${c.chainId}: ${(err as Error).message.slice(0, 80)}`); }
}
console.log(`key prefixes: ${prefixes.size} (${discovered.size} found only in verified controller sources${discovered.size ? `: ${[...discovered].join(", ")}` : ""})`);

// ---------------------------------------------------------------- key table in every encoding the controllers use
const table = new Map<string, string>();
const keyAddr = new Map<string, string>(); // key -> the candidate address encoded into it (same-named vaults never collide here)
const enc = (ph: `0x${string}`, types: { type: string }[], values: unknown[]) => keccak256(encodeAbiParameters(types, [ph, ...values])).toLowerCase();
const T = (...types: string[]) => [{ type: "bytes32" }, ...types.map((type) => ({ type }))];
const pairAddrs = [...new Set([...reg.map((e) => lower(e.address)), ...counterparties])];
const IDS = [...Array(100).keys(), ...Array.from({ length: 400 }, (_, i) => 30100 + i)]; // CCTP domains, Centrifuge ids, LayerZero endpoint ids
for (const name of prefixes) {
  const ph = keccak256(toHex(name));
  table.set(ph.toLowerCase(), `${name} (plain)`);
  for (const [a, desc] of candidates) { const k = enc(ph, T("address"), [getAddress(a)]); table.set(k, `${name} x ${desc}`); keyAddr.set(k, a); }
  for (const d of IDS.slice(0, 64)) table.set(enc(ph, T("uint32"), [d]), `${name} x domain ${d}`);
  if (name === "LIMIT_ASSET_TRANSFER") for (const a of pairAddrs) for (const b of pairAddrs) table.set(enc(ph, T("address", "address"), [getAddress(a), getAddress(b)]), `${name} x ${a.slice(0, 10)}… -> ${b.slice(0, 10)}…`);
  if (/LAYERZERO|CENTRIFUGE_TRANSFER/.test(name)) for (const a of pairAddrs) for (const d of IDS) table.set(enc(ph, T("address", "uint32"), [getAddress(a), d]), `${name} x ${a.slice(0, 10)}… -> id ${d}`);
}
console.log(`key table: ${table.size} computed keys\n`);

// ---------------------------------------------------------------- every key each Prime rate-limit contract ever set
const listed = new Set(sky.groups.flatMap((g) => g.vaults.flatMap((v) => v.allocatable.map((a) => `${v.chainId}:${a.prime}:${lower(v.address)}`))));
let misses = 0, unexplained = 0;
const liveByChain = new Map<number, Set<string>>();
for (const rl of reg.filter((e) => e.role === "almRateLimits").sort((a, b) => a.chainId - b.chainId)) {
  if (!MORPHO_CHAINS.includes(rl.chainId)) { if (!only) console.log(`${rl.prime} ${rl.constant} on chain ${rl.chainId}: skipped, Morpho is not deployed there`); continue; }
  if (!inScope(rl.chainId)) continue;
  let keys: string[];
  try { keys = [...new Set((await fetchLogs(rl.chainId, rl.address, TOPIC)).map((l) => lower(l.topics[1])))]; }
  catch (e) { console.log(`${rl.prime} ${rl.constant} chain ${rl.chainId}: logs unavailable (${(e as Error).message.slice(0, 80)})`); gaps.push(`${rl.prime} ${rl.constant} chain ${rl.chainId}`); continue; }
  const reader = makeReader(deps, rl.chainId)!;
  const res = await reader.read(keys.map((k) => ({ key: k, address: rl.address as `0x${string}`, abi: rateLimitsAbi as Abi, functionName: "getRateLimitData", args: [k as `0x${string}`] })));
  const failedReads = keys.filter((k) => !res[k]?.ok);
  if (failedReads.length) throw new Error(`${failedReads.length} rate-limit reads failed on chain ${rl.chainId}; a failed read is not "no limit"`);
  const isVaultKey = (k: string) => (table.get(k) ?? "").startsWith("LIMIT_4626_DEPOSIT x Morpho vault");
  const live = keys.filter((k) => (res[k].value as any).maxAmount > 0n); // a non-zero maximum is what lets the agent act
  const zeroed = keys.filter((k) => (res[k].value as any).maxAmount === 0n && (res[k].value as any).lastUpdated > 0n); // set once, later zeroed: offboarded
  for (const k of live) (liveByChain.get(rl.chainId) ?? liveByChain.set(rl.chainId, new Set()).get(rl.chainId)!).add(k);
  const vaultKeys = live.filter(isVaultKey);
  const unknown = live.filter((k) => !table.has(k));
  console.log(`${rl.prime} ${rl.constant} on chain ${rl.chainId} (${rl.address}): ${keys.length} keys ever set, ${live.length} live, ${zeroed.length} zeroed, ${vaultKeys.length} live Morpho-vault deposit keys, ${unknown.length} live keys nothing explains`);
  for (const k of zeroed.filter(isVaultKey)) console.log(`    zeroed   ${/"(.*)"/.exec(table.get(k)!)![1]} ${keyAddr.get(k)} (deposit limit set once, now 0: offboarded)`);
  for (const k of live) {
    const desc = table.get(k) ?? "UNEXPLAINED";
    const m = /^LIMIT_4626_DEPOSIT x Morpho vault "(.*)" \(chain (\d+)\)$/.exec(desc);
    if (m) {
      const addr = keyAddr.get(k) ?? "?";
      const inList = listed.has(`${rl.chainId}:${rl.prime}:${addr}`);
      if (!inList) misses++;
      console.log(`    ${inList ? "listed  " : "MISSING "} ${m[1]} ${addr} (vault chain ${m[2]})`);
    } else if (desc === "UNEXPLAINED") { unexplained++; const v = res[k].value as any; console.log(`    UNEXPLAINED key ${k.slice(0, 18)}… max ${v.maxAmount} slope ${v.slope} lastUpdated ${v.lastUpdated}`); }
  }
  const nonVault = live.filter((k) => table.has(k) && !vaultKeys.includes(k)).map((k) => table.get(k)!.replace(/ \(chain \d+\)$/, ""));
  if (nonVault.length) console.log(`    other live keys (${nonVault.length}): ${[...new Set(nonVault.map((d) => d.split(" x ")[0]))].join(", ")}`);
}

// ---------------------------------------------------------------- vault universe from the factories, independent of the API's index
console.log("\nfactory cross-check (every address in the factories' creation events, confirmed by the factory, against every live key):");
let unindexedHits = 0;
for (const chainId of [...liveByChain.keys()].sort((a, b) => a - b)) {
  const fs = [...(factories.get(chainId) ?? [])];
  const seen = new Map<string, "v1" | "v2">(); // address-shaped topic -> factory kind
  const failed: string[] = [];
  let events = 0;
  for (const [f, kind] of fs) {
    try {
      const logs = await fetchLogs(chainId, f, null);
      events += logs.length;
      for (const l of logs) for (const t of l.topics.slice(1)) if (/^0x0{24}[0-9a-f]{40}$/i.test(t)) seen.set(lower("0x" + t.slice(26)), kind);
    } catch (e) { failed.push(`${f.slice(0, 10)}… (${(e as Error).message.slice(0, 60)})`); gaps.push(`factory ${f.slice(0, 10)}… chain ${chainId}`); }
  }
  const unindexed = [...seen].filter(([a]) => !candidates.has(a) || !candidates.get(a)!.startsWith("Morpho vault"));
  const reader = makeReader(deps, chainId)!;
  const byFactory = new Map<string, { a: string; kind: "v1" | "v2" }[]>();
  for (const [a, kind] of unindexed) for (const [f, k2] of fs) if (k2 === kind) (byFactory.get(f) ?? byFactory.set(f, []).get(f)!).push({ a, kind });
  const confirmed: string[] = [];
  for (const [f, items] of byFactory) {
    const res = await reader.read(items.map(({ a, kind }) => ({ key: `${f}:${a}`, address: getAddress(f), abi: (kind === "v2" ? vaultV2FactoryAbi : metaMorphoFactoryAbi) as Abi, functionName: kind === "v2" ? "isVaultV2" : "isMetaMorpho", args: [getAddress(a)] })));
    for (const { a } of items) if (res[`${f}:${a}`]?.ok && res[`${f}:${a}`].value === true) confirmed.push(a);
  }
  const live = liveByChain.get(chainId)!;
  const ph = keccak256(toHex("LIMIT_4626_DEPOSIT"));
  const hits = confirmed.filter((a) => live.has(enc(ph, T("address"), [getAddress(a)])));
  unindexedHits += hits.length;
  // positions: the list reads Prime positions from the API, which cannot see these vaults; ask the vaults directly
  const proxies = reg.filter((e) => e.role === "almProxy" && e.chainId === chainId);
  const calls = confirmed.flatMap((a) => proxies.map((p) => ({ key: `${a}:${p.address}`, address: getAddress(a), abi: erc4626Abi as Abi, functionName: "balanceOf", args: [getAddress(p.address)] })));
  const bal = calls.length ? await reader.read(calls) : {};
  const held = calls.filter((c) => bal[c.key]?.ok && (bal[c.key].value as bigint) > 0n);
  const names: Record<string, string> = {};
  if (held.length) {
    const nm = await reader.read([...new Set(held.map((c) => c.address))].flatMap((a) => [{ key: `${a}:name`, address: a, abi: erc4626Abi as Abi, functionName: "name", args: [] }, { key: `${a}:decimals`, address: a, abi: erc4626Abi as Abi, functionName: "decimals", args: [] }]));
    for (const a of new Set(held.map((c) => c.address))) names[lower(a)] = `${nm[`${a}:name`]?.ok ? nm[`${a}:name`].value : "?"} (${nm[`${a}:decimals`]?.ok ? nm[`${a}:decimals`].value : "?"} decimals)`;
  }
  console.log(`  chain ${chainId}: ${fs.length} factories, ${events} creation events, ${seen.size} distinct addresses, ${unindexed.length} not indexed as vaults by the API, ${confirmed.length} of those confirmed as vaults by the factory, ${hits.length} with a live deposit key, ${held.length} Prime holding(s)${failed.length ? `; logs failed for ${failed.join(", ")}` : ""}`);
  for (const a of hits) console.log(`    LIVE DEPOSIT KEY for factory vault the API does not index: ${a}`);
  for (const c of held) { const [a, p] = c.key.split(":"); const pr = proxies.find((x) => x.address === p)!; console.log(`    holding: ${pr.prime} ${pr.constant} holds ${bal[c.key].value} shares of ${a} ${names[lower(a)]}, a factory vault the API does not index`); }
}
console.log(`\nresult: ${misses} live Morpho-vault deposit key(s) missing from the list, ${unindexedHits} live deposit key(s) for factory vaults the API does not index, ${unexplained} live key(s) unexplained${gaps.length ? `; NOT COVERED (logs unavailable): ${gaps.join(", ")}` : "; every contract covered"}`);
process.exit(misses || unindexedHits ? 1 : gaps.length ? 10 : 0); // 1: the list is wrong; 10: the run could not see everything; 0: clean
