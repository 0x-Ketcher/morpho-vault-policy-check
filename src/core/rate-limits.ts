/**
 * Prime rate-limit keys, pure logic shared by the cross-check (scripts/verify-rate-limits.ts) and its tests.
 * A key is keccak256(abi.encode(prefixHash, ...values)) where prefixHash = keccak256("LIMIT_…"), in the encodings the
 * controllers' verified sources use: the prefix alone, prefix plus address, prefix plus uint32 domain, prefix plus
 * asset and destination, prefix plus address and uint32 id. No I/O here.
 */
import { keccak256, encodeAbiParameters, toHex, getAddress } from "viem";

export const RATE_LIMIT_SET_TOPIC = keccak256(toHex("RateLimitDataSet(bytes32,uint256,uint256,uint256,uint256)"));
export const prefixHash = (name: string) => keccak256(toHex(name));
const lower = (a: string) => a.toLowerCase();

/** keccak256(abi.encode(prefixHash, ...values)) with the given solidity types, lowercased. */
export function keyFor(prefix: string, types: string[], values: unknown[]): string {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, ...types.map((type) => ({ type }))], [prefixHash(prefix), ...values])).toLowerCase();
}
export const depositKey = (vault: string) => keyFor("LIMIT_4626_DEPOSIT", ["address"], [getAddress(vault)]);

export interface KeyTable { table: Map<string, string>; keyAddr: Map<string, string> }

/**
 * Every key the candidates could produce under every prefix and encoding. `table` maps key -> description;
 * `keyAddr` maps key -> the candidate address encoded into it, so two candidates with the same description
 * (same-named vaults) never collide.
 */
export function buildKeyTable(opts: { prefixes: Iterable<string>; candidates: Map<string, string>; pairAddrs?: string[]; ids?: number[]; domains?: number }): KeyTable {
  const table = new Map<string, string>(), keyAddr = new Map<string, string>();
  const pairAddrs = opts.pairAddrs ?? [], ids = opts.ids ?? [], domains = opts.domains ?? 64;
  for (const name of opts.prefixes) {
    table.set(prefixHash(name).toLowerCase(), `${name} (plain)`);
    for (const [a, desc] of opts.candidates) { const k = keyFor(name, ["address"], [getAddress(a)]); table.set(k, `${name} x ${desc}`); keyAddr.set(k, lower(a)); }
    for (let d = 0; d < domains; d++) table.set(keyFor(name, ["uint32"], [d]), `${name} x domain ${d}`);
    if (name === "LIMIT_ASSET_TRANSFER") for (const a of pairAddrs) for (const b of pairAddrs) table.set(keyFor(name, ["address", "address"], [getAddress(a), getAddress(b)]), `${name} x ${a.slice(0, 10)}… -> ${b.slice(0, 10)}…`);
    if (/LAYERZERO|CENTRIFUGE_TRANSFER/.test(name)) for (const a of pairAddrs) for (const d of ids) table.set(keyFor(name, ["address", "uint32"], [getAddress(a), d]), `${name} x ${a.slice(0, 10)}… -> id ${d}`);
  }
  return { table, keyAddr };
}

/** The distinct keys a rate-limit contract's RateLimitDataSet logs carry (topic 1). */
export const keysFromLogs = (logs: { topics: string[] }[]) => [...new Set(logs.map((l) => lower(l.topics[1])))];
/** Every address-shaped indexed topic in creation logs, so the event layout need not be assumed. */
export const addressesFromCreationLogs = (logs: { topics: string[] }[]) => [...new Set(logs.flatMap((l) => l.topics.slice(1)).filter((t) => /^0x0{24}[0-9a-f]{40}$/i.test(t)).map((t) => lower("0x" + t.slice(26))))];
/** Every LIMIT_… identifier in a controller's verified source text. */
export const prefixesFromSource = (source: string) => [...new Set(source.match(/LIMIT_[A-Z0-9_]+/g) ?? [])];

export interface RateLimitValue { maxAmount: bigint; lastUpdated: bigint }
export interface VaultKey { key: string; address: string; name: string; chainId: number; inList: boolean }
export interface Classified {
  /** keys with a non-zero maximum: the agent can act */
  live: string[];
  /** set once, now zero: offboarded */
  zeroed: string[];
  /** live LIMIT_4626_DEPOSIT keys of Morpho vaults, each marked listed or missing */
  vaultKeys: VaultKey[];
  zeroedVaultKeys: Omit<VaultKey, "inList">[];
  /** live keys the table does not explain */
  unexplained: string[];
  /** prefixes of the other live, explained keys */
  otherPrefixes: string[];
}

const VAULT_DESC = /^LIMIT_4626_DEPOSIT x Morpho vault "(.*)" \(chain (\d+)\)$/;

/** Sorts one contract's keys by their live values and the key table; `listed` holds "chainId:prime:address" entries of the vault list. */
export function classify(opts: { keys: string[]; values: Record<string, RateLimitValue>; keyTable: KeyTable; listed: Set<string>; chainId: number; prime: string }): Classified {
  const { table, keyAddr } = opts.keyTable;
  const val = (k: string) => { const v = opts.values[k]; if (!v) throw new Error(`no value read for key ${k}`); return v; };
  const live = opts.keys.filter((k) => val(k).maxAmount > 0n);
  const zeroed = opts.keys.filter((k) => val(k).maxAmount === 0n && val(k).lastUpdated > 0n);
  const vaultOf = (k: string) => { const m = VAULT_DESC.exec(table.get(k) ?? ""); return m ? { key: k, address: keyAddr.get(k) ?? "?", name: m[1], chainId: Number(m[2]) } : null; };
  const vaultKeys = live.map(vaultOf).filter((x): x is NonNullable<typeof x> => x !== null).map((x) => ({ ...x, inList: opts.listed.has(`${opts.chainId}:${opts.prime}:${x.address}`) }));
  const zeroedVaultKeys = zeroed.map(vaultOf).filter((x): x is NonNullable<typeof x> => x !== null);
  const unexplained = live.filter((k) => !table.has(k));
  const otherPrefixes = [...new Set(live.filter((k) => table.has(k) && !vaultOf(k)).map((k) => table.get(k)!.split(" x ")[0].replace(/ \(plain\)$/, " (plain)")))];
  return { live, zeroed, vaultKeys, zeroedVaultKeys, unexplained, otherPrefixes };
}
