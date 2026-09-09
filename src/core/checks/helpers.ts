import type { VaultSnapshot, CheckResult, Status, Evidence, Citation, SafeInfo } from "../types.ts";
import type { LabelBook, Attribution, Side } from "../../sources/labels/index.ts";
import type { PolicyConfig } from "../policy.ts";

export interface CheckContext {
  policy: PolicyConfig;
  labels: LabelBook;
  /** on-chain snapshot, null when no chain-side provider exists for the chain */
  a: VaultSnapshot | null;
  /** Morpho API snapshot, always present */
  b: VaultSnapshot;
  chainName: string;
}

export interface CheckDef {
  id: string;
  title: string;
  evaluate: (ctx: CheckContext) => CheckResult;
}

export const ORDER: Status[] = ["FAIL", "WARN", "PASS", "INFO", "NA"];
export const worst = (s: Status[]): Status => s.length ? s.slice().sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y))[0] : "NA";
export const short = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const ZERO = "0x0000000000000000000000000000000000000000";

const norm = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x) ? x.toLowerCase() : x));

export interface Picked<T> { value: T; a?: T; b: T; discrepancy: boolean; single: boolean; evidence: Evidence[] }

/** Read one value from both snapshots. On-chain takes precedence for the verdict; a disagreement is flagged, never resolved. */
export function pick<T>(ctx: CheckContext, label: string, extract: (s: VaultSnapshot) => T, fmt: (t: T) => string = (t) => norm(t), opts: { tolerance?: (a: T, b: T) => boolean } = {}): Picked<T> {
  const b = extract(ctx.b);
  const a = ctx.a ? extract(ctx.a) : undefined;
  const evidence: Evidence[] = [];
  if (ctx.a) evidence.push({ method: "onchain", label, value: a === undefined ? "n/a" : fmt(a), block: ctx.a.meta.block, source: ctx.a.meta.providers?.[0] });
  evidence.push({ method: "api", label, value: b === undefined ? "n/a" : fmt(b), source: "blue-api.morpho.org" });
  const single = !ctx.a || a === undefined || b === undefined;
  const same = single ? true : opts.tolerance ? opts.tolerance(a as T, b) : norm(a) === norm(b);
  return { value: (ctx.a && a !== undefined ? a : b) as T, a, b, discrepancy: !same, single, evidence };
}

export function result(id: string, title: string, requirement: string, status: Status, summary: string, picks: Picked<unknown>[], details: string[] = [], citations: Citation[] = [], extra: Partial<CheckResult> = {}): CheckResult {
  const name = (m: string) => (m === "onchain" ? "on-chain" : m === "api" ? "API" : m);
  const discrepancies = picks.filter((p) => p.discrepancy).map((p) => `${p.evidence[0]?.label ?? "value"}: ${p.evidence.map((e) => `${name(e.method)} ${e.value}`).join(" vs ")}`);
  return {
    id, title, requirement, status,
    discrepancy: discrepancies.length > 0, discrepancies,
    singleSource: picks.length > 0 && picks.every((p) => p.single),
    summary, details, evidence: picks.flatMap((p) => p.evidence), citations: dedupeCitations(citations), ...extra,
  };
}

export function dedupeCitations(c: Citation[]): Citation[] {
  const seen = new Set<string>();
  return c.filter((x) => { const k = `${x.source}|${x.ref}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export const fmtAddr = (a: string | null | undefined) => (a ? a : "none");
export const fmtDays = (secs: number) => (secs % 86400 === 0 ? `${secs / 86400}d` : secs >= 3600 ? `${(secs / 86400).toFixed(2)}d` : `${secs}s`);
export const fmtUsd = (x?: number) => (x === undefined || Number.isNaN(x) ? "n/a" : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${x.toFixed(2)}`);
export const fmtUnits = (raw: string | undefined, decimals?: number, symbol?: string) => {
  if (raw === undefined) return "n/a";
  if (decimals === undefined) return raw;
  const n = Number(raw) / 10 ** decimals;
  const s = n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(2);
  return symbol ? `${s} ${symbol}` : s;
};

const ROLE_WORDS: Record<string, string> = {
  subproxy: "governance SubProxy", executor: "governance executor", almProxy: "ALM proxy", almRateLimits: "rate limits", almController: "ALM controller",
  morphoCurator: "curator multisig", morphoGuardian: "guardian multisig", morphoVault: "vault", multisig: "multisig", oeaOperator: "OEA operator", curatorRegistry: "external curator",
};
const SOURCE_WORDS: Record<string, string> = { registry: "Prime registry", atlas: "Atlas", "morpho-curators": "Morpho curator registry", "safe-owners": "signer overlap", local: "non-public label" };

/** Plain-words attribution for prose: entity, role in words, source name. The exact citations are rendered separately. */
export function describe(att: Attribution): string {
  if (att.side === "unknown" && !att.entity) return "unlabeled";
  const roles = att.roles.map((r) => ROLE_WORDS[r]).filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 2);
  const first = att.citations.find((c) => c.source !== "safe-owners") ?? att.citations[0];
  const src = first && first.source !== "safe-owners" ? SOURCE_WORDS[first.source] ?? first.source : undefined;
  return `${att.entity ?? att.side}${roles.length ? `, ${roles.join(" and ")}` : ""}${src ? ` per ${src}` : ""}`;
}

/** Leaf signer set of a Safe: EOA owners plus, for owner Safes, their owners (one level). */
export function leafSigners(safe: SafeInfo | undefined): Set<string> {
  const out = new Set<string>();
  if (!safe?.isSafe) return out;
  for (const o of safe.owners ?? []) {
    const nested = safe.ownerSafes?.[o.toLowerCase()];
    if (nested?.isSafe) for (const x of nested.owners ?? []) out.add(x.toLowerCase());
    else out.add(o.toLowerCase());
  }
  return out;
}

export interface SideCall extends Attribution { via?: string }

/** Attribution with a fallback: an unlabeled Safe inherits the side of a labeled Safe it shares signers with. */
export function attributeSafe(ctx: CheckContext, address: string, safe: SafeInfo | undefined): SideCall {
  const chainId = ctx.b.chainId;
  const direct = ctx.labels.attribute(address, chainId);
  if (direct.side !== "unknown" || !safe?.isSafe) return direct;
  const mine = leafSigners(safe);
  if (mine.size === 0) return direct;
  let best: { side: Side; label: string; shared: number; entity?: string; prime?: string } | undefined;
  for (const e of ctx.labels.allSafeOwners()) {
    if (!e.isSafe || !e.owners?.length || e.address.toLowerCase() === address.toLowerCase()) continue;
    const shared = e.owners.filter((o) => mine.has(o.toLowerCase())).length;
    if (shared === 0) continue;
    const att = ctx.labels.attribute(e.address, e.chainId);
    if (att.side === "unknown") continue;
    const rank = (s: Side) => (s === "oea" ? 3 : s === "prime" ? 2 : 1);
    if (!best || rank(att.side) > rank(best.side) || (rank(att.side) === rank(best.side) && shared > best.shared)) {
      best = { side: att.side, label: `${att.entity ?? short(e.address)}'s Safe ${short(e.address)}${e.chainId !== chainId ? ` on chain ${e.chainId}` : ""}`, shared, entity: att.entity, prime: att.prime };
    }
  }
  if (!best) return direct;
  return {
    ...direct, side: best.side, entity: direct.entity ?? best.entity, prime: direct.prime ?? best.prime,
    via: `by signer overlap, ${best.shared} shared signer${best.shared > 1 ? "s" : ""} with ${best.label}`,
    citations: [...direct.citations, { source: "safe-owners", entity: best.entity, ref: `signer overlap (${best.shared}) with labeled Safe ${best.label}` }],
  };
}

export const isPrimeGovernance = (att: Attribution) => att.side === "prime" && (att.roles.includes("subproxy") || att.roles.includes("executor"));
