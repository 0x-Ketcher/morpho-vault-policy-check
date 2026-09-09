import { useEffect, useMemo, useState } from "react";
import { policy, providers, skyVaults, labels, type SkyVault } from "./data.ts";
import { refreshVaultNumbers } from "./vaults-live.ts";
import { checkFreshness, type Freshness } from "./freshness.ts";
import { MorphoApi } from "../sources/morpho-api/client.ts";
import { checkVault, findCandidates, ETHERSCAN_MORPHO_CHAINS, type Deps } from "../pipeline.ts";
import { renderMarkdown } from "../core/render.ts";
import { fmtUsd } from "../core/checks/helpers.ts";
import type { Report, CheckResult, Status, Citation, Evidence, CheckTable as CheckTableData, CheckCell } from "../core/types.ts";

const STATUS_LABEL: Record<Status, string> = { PASS: "PASS", WARN: "WARN", FAIL: "FAIL", NA: "n/a", INFO: "info" };
const GRADED = ["C1", "C2", "C3", "C4", "C5", "C6", "C7"];
const METHODOLOGY = "/methodology"; // served by the server from the repository's own documentation
const utc = (iso: string) => iso.replace("T", " ").slice(0, 16) + " UTC";

export function App() {
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState<string>("auto");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proxyAvailable, setProxyAvailable] = useState<boolean | null>(null);
  const [freshness, setFreshness] = useState<Freshness[] | null>(null);
  const [groups, setGroups] = useState(skyVaults.groups);

  useEffect(() => {
    fetch("/api/health").then((r) => (r.ok ? r.json() : null)).then((d) => setProxyAvailable(!!d?.etherscan)).catch(() => setProxyAvailable(false));
    try { localStorage.removeItem("etherscan-key"); } catch { /* an earlier version let a visitor store a key here; nothing reads it any more */ }
    checkFreshness().then(setFreshness).catch(() => setFreshness(null));
    refreshVaultNumbers(skyVaults.groups).then(setGroups).catch(() => {});
    const params = new URLSearchParams(location.search);
    const a = params.get("address"), c = params.get("chain");
    if (a) { setAddress(a); if (c) setChain(c); }
  }, []);

  const deps = useMemo<Deps>(() => {
    // Etherscan is reachable only through the server's proxy route, which holds the key; the page never carries one
    const etherscan = proxyAvailable ? { base: `${location.origin}/api/etherscan`, chains: ETHERSCAN_MORPHO_CHAINS } : undefined;
    return { policy, providers, labels, api: new MorphoApi(providers.morphoApi), etherscan, log: (m) => setLog((l) => [...l, m]) };
  }, [proxyAvailable]);

  async function run(addr = address, chainId = chain) {
    setRunning(true); setError(null); setReport(null); setLog([]);
    try {
      const cid = chainId === "auto" ? undefined : Number(chainId);
      if (cid === undefined) {
        const found = await findCandidates(deps, addr.trim());
        if (found.length > 1) { setError(`This address is a Morpho vault on several chains: ${found.map((f) => `${f.network} (${f.chainId})`).join(", ")}. Pick the chain.`); setRunning(false); return; }
      }
      const r = await checkVault(deps, addr.trim(), cid);
      setReport(r);
      const url = new URL(location.href); url.searchParams.set("address", r.vault.address); url.searchParams.set("chain", String(r.vault.chainId)); history.replaceState(null, "", url.toString());
    } catch (e) { setError((e as Error).message); }
    setRunning(false);
  }

  function exportReport(r: Report) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([renderMarkdown(r, policy.meta.deadline)], { type: "text/markdown" })); a.download = `${r.vault.chainId}-${r.vault.address}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const stale = (freshness ?? []).filter((f) => f.behind);

  return (
    <div className="page">
      <header>
        <div className="header-row">
          <h1>Morpho vault policy check</h1>
          {policy.meta.deadline && <Deadline d={policy.meta.deadline} />}
        </div>
        <p className="sub">Checks a Morpho vault against the <a href={policy.meta.policyUrl} target="_blank" rel="noreferrer">BA Labs Morpho Vaults v2 eligibility criteria</a>.</p>
      </header>

      <section className="input">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (!running && address) void run(); }}>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="vault address 0x…" spellCheck={false} />
          <select value={chain} onChange={(e) => setChain(e.target.value)} title="chain">
            <option value="auto">chain: detect</option>
            {Object.entries(providers.chains).map(([id, c]) => <option key={id} value={id}>{c.name} ({id})</option>)}
          </select>
          <button type="submit" disabled={running || !address}>{running ? "Checking…" : "Check vault"}</button>
        </form>
        <div className="row">
          <VaultPicker groups={groups} disabled={running} onPick={(v) => { setAddress(v.address); setChain(String(v.chainId)); void run(v.address, String(v.chainId)); }} />
        </div>
        {stale.length > 0 && <p className="stale">Address ownership data may be out of date: {stale.map((b) => b.repo.split("/")[1]).join(", ")} changed since the last update.</p>}
      </section>

      {running && log.length > 0 && <p className="log">{log[log.length - 1]}</p>}
      {error && <div className="error">{error}</div>}

      {report && <Result r={report} onExport={() => exportReport(report)} />}

      <p className="foot"><a href={METHODOLOGY} target="_blank" rel="noreferrer">Methodology</a></p>
    </div>
  );
}

function Result({ r, onExport }: { r: Report; onExport: () => void }) {
  const counts = (["FAIL", "WARN", "PASS"] as Status[]).map((s) => ({ s, n: r.checks.filter((c) => c.status === s).length })).filter((x) => x.n > 0);
  const graded = r.checks.filter((c) => GRADED.includes(c.id));
  const context = r.checks.filter((c) => !GRADED.includes(c.id));
  const checkedAt = r.snapshotB.meta.fetchedAt;
  return (
    <section className="result">
      <div className="vault card">
        <div className="vault-head">
          <h2>{r.vault.name ?? "Vault"} <span className="muted">{r.vault.symbol}</span> <span className="bubble">{r.vault.version === "v2" ? "V2" : "v1.1"}</span></h2>
        </div>
        <p className="mono small">{r.vault.address}</p>
        <p className="facts">{r.vault.chainName} · {r.vault.asset ?? "?"} · TVL {fmtUsd(r.vault.totalAssetsUsd)}</p>
        <div className="summary-row">
          <div className="counts">{counts.map((x) => <span key={x.s} className={`badge ${x.s}`}>{x.n} {STATUS_LABEL[x.s]}</span>)}</div>
        </div>
        <details className="run">
          <summary className="muted small">Checked {utc(checkedAt)} · run details</summary>
          <ul className="small">
            <li>Chain state read at block {r.providers.block}{r.providers.blockTimestamp ? ` (${utc(new Date(r.providers.blockTimestamp * 1000).toISOString())})` : ""} via {r.providers.primary}; {r.providers.calls} reads.</li>
            <li>Morpho API read at {utc(r.snapshotB.meta.fetchedAt)}.</li>
            {r.providers.disagreements.map((d, i) => <li key={`p${i}`}>{d}</li>)}
            {(r.snapshotA?.meta.notes ?? []).map((n, i) => <li key={`a${i}`}>on-chain: {n}</li>)}
            {r.snapshotB.meta.notes.map((n, i) => <li key={`b${i}`}>api: {n}</li>)}
            {!r.snapshotA && <li>No chain-side provider for this chain: every value is API-only.</li>}
            <li><a href="#" onClick={(e) => { e.preventDefault(); onExport(); }}>Export report</a> (Markdown, with every value and source)</li>
          </ul>
        </details>
      </div>
      <div className="cards">{graded.map((c) => <Card key={c.id} c={c} />)}</div>
      <h3 className="section">Context, not graded</h3>
      <div className="cards context">{context.map((c) => <Card key={c.id} c={c} compact />)}</div>
    </section>
  );
}

function Card({ c, compact = false }: { c: CheckResult; compact?: boolean }) {
  const [open, setOpen] = useState(c.discrepancy || (!compact && (c.status === "FAIL" || c.status === "WARN")));
  const rule = policy.checkRules?.[c.id];
  return (
    <div id={c.id} className={`card check ${c.status} ${compact ? "compact" : ""}`}>
      <div className="check-head" onClick={() => setOpen((o) => !o)}>
        <span className={`badge ${c.status}`}>{STATUS_LABEL[c.status]}</span>
        <h3><span className="cid">{c.id}</span> {c.title}</h3>
        {c.discrepancy && <span className="tag disc">methods disagree</span>}
        {!c.discrepancy && c.singleSource && <span className="tag">one method only</span>}
      </div>
      <p className="summary">{c.summary}</p>
      {open && (
        <div className="body">
          {rule && <p className="rule"><span className="rule-label">Criteria</span> {rule}</p>}
          {!c.table && <EvidenceBlock evidence={c.evidence} discrepancy={c.discrepancy} />}
          {c.discrepancies.length > 0 && <div className="disc-box"><b>Methods disagree</b>, not auto-resolved; the verdict uses the on-chain value:<ul>{c.discrepancies.map((d, i) => <li key={i} className="mono small">{d}</li>)}</ul></div>}
          {c.table ? <CheckTable t={c.table} /> : <Details lines={c.details} />}
          {c.citations.length > 0 && <div className="cites">{c.citations.map((x, i) => <Chip key={i} x={x} />)}</div>}
        </div>
      )}
    </div>
  );
}

function CheckTable({ t }: { t: CheckTableData }) {
  const cell = (x: CheckCell, i: number) => {
    if (typeof x === "string") return <td key={i}>{x}</td>;
    return <td key={i} className={`${x.mono ? "mono " : ""}${x.muted ? "muted " : ""}small`}>{x.status ? <span className={`cell ${x.status}`}>{x.text}</span> : x.text}</td>;
  };
  return (
    <div className="tablewrap"><table className="findings"><thead><tr>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>
      {t.rows.map((r, i) => <tr key={i}>{r.map(cell)}</tr>)}
    </tbody></table></div>
  );
}

/** Silent when the methods agree. On a disagreement, only the values that differ are shown, one pair of rows each. */
function EvidenceBlock({ evidence, discrepancy }: { evidence: Evidence[]; discrepancy: boolean }) {
  if (!discrepancy || evidence.length === 0) return null;
  const byLabel = new Map<string, Evidence[]>();
  for (const e of evidence) { const arr = byLabel.get(e.label) ?? []; arr.push(e); byLabel.set(e.label, arr); }
  const differing = [...byLabel.values()].filter((es) => new Set(es.map((e) => e.value)).size > 1).flat();
  if (differing.length === 0) return null;
  return (
    <table><thead><tr><th>method</th><th>value</th><th>read at</th></tr></thead><tbody>
      {differing.map((e, i) => <tr key={i}><td>{e.method}<br /><span className="muted small">{e.label}</span></td><td className="mono small">{e.value}</td><td className="small">{e.block ? `block ${e.block}` : e.source ?? ""}</td></tr>)}
    </tbody></table>
  );
}

/** Per-market and per-seat lines stay visible; the indented signer lines fold under a count. */
function Details({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  const groups: { head: string; signers: string[] }[] = [];
  for (const l of lines) {
    if (l.startsWith("  ") && groups.length) groups[groups.length - 1].signers.push(l.trim());
    else groups.push({ head: l.trim(), signers: [] });
  }
  return (
    <ul className="details">
      {groups.map((g, i) => {
        const isSigners = g.signers[0]?.startsWith("signer ");
        const isHeader = g.head.endsWith(":"); // a header line: its items are shown directly
        return (
          <li key={i}>
            {g.head}
            {g.signers.length > 0 && isHeader && <ul className="small sub">{g.signers.map((s, j) => <li key={j}>{s}</li>)}</ul>}
            {g.signers.length > 0 && !isHeader && (
              <details className="signers">
                <summary className="muted small">{isSigners ? `${g.signers.length} signer${g.signers.length > 1 ? "s" : ""}, ${g.signers.filter((s) => !/unlabeled/.test(s)).length} publicly labeled` : `show ${g.signers.length}`}</summary>
                <ul className={`small sub ${isSigners ? "mono" : ""}`}>{g.signers.map((s, j) => <li key={j}>{s.replace(/^signer /, "")}</li>)}</ul>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Chip({ x }: { x: Citation }) {
  const constant = /\s([A-Z][A-Z0-9_]+)(?:\s\(chain \d+\))?$/.exec(x.ref)?.[1];
  const text = x.source === "registry" ? `${x.entity ?? "registry"} registry${constant ? ` · ${constant}` : ""}`
    : x.source === "atlas" ? (/Atlas (A[\d.]+)/.exec(x.ref)?.[0] ?? "Atlas")
    : x.source === "morpho-curators" ? `Morpho curators · ${x.entity ?? ""}`
    : x.source === "safe-owners" ? `signer overlap${x.entity ? ` · ${x.entity}` : ""}`
    : `non-public · ${x.entity ?? ""}`;
  const cls = `cite ${x.source}${x.nonPublic ? " nonpublic" : ""}`;
  return x.url ? <a className={cls} href={x.url} target="_blank" rel="noreferrer" title={x.ref}>{text}</a> : <span className={cls} title={x.ref}>{text}</span>;
}

const statusWord = (s: string) => ({ "pending spell": "pending spell", "no position": "no position" })[s] ?? "";

/** Grouped vault list with the exposure / TVL figures as their own coloured column. A native select cannot colour part of an option. */
function VaultPicker({ groups, disabled, onPick }: { groups: { prime: string; exposureUsd: number; vaults: SkyVault[] }[]; disabled: boolean; onPick: (v: SkyVault) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as HTMLElement).closest(".vpick")) setOpen(false); };
    const t = setTimeout(() => { document.addEventListener("click", close); document.addEventListener("keydown", close); }, 0);
    return () => { clearTimeout(t); document.removeEventListener("click", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const nums = (exposure: number, tvl: number) => `${exposure >= 1 ? fmtUsd(exposure) : "$0"} / ${tvl < 1 ? "empty" : fmtUsd(tvl)}`;
  // several deployments can share one name on one chain; only those get the last four characters of their address
  const counts = new Map<string, number>();
  for (const v of groups.flatMap((g) => g.vaults)) { const k = `${v.chainId}:${v.name}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
  const suffix = (v: SkyVault) => ((counts.get(`${v.chainId}:${v.name}`) ?? 0) > 1 ? ` · ${v.address.slice(-4)}` : "");
  return (
    <div className="vpick">
      <button type="button" className="ghost" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>pick a Sky vault ▾</button>
      {open && (
        <div className="vpick-panel" role="listbox">
          {groups.map((g) => (
            <div key={g.prime} className="vpick-group">
              <div className="vpick-head"><span>{g.prime}</span><span className="nums">exposure {fmtUsd(g.exposureUsd)} / TVL {fmtUsd(g.vaults.reduce((t, v) => t + v.tvlUsd, 0))}</span></div>
              {g.vaults.map((v) => (
                <button type="button" key={`${v.chainId}:${v.address}`} className="vpick-row" role="option" onClick={() => { setOpen(false); onPick(v); }}>
                  <span className="vpick-name">{v.name} <span className="muted">· {v.chain.replace(" Chain", "")}{suffix(v)}</span></span>
                  <span className="vpick-right"><span className="vpick-status">{statusWord(v.status)}</span><span className="nums">{nums(v.exposureUsd, v.tvlUsd)}</span></span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Deadline({ d }: { d: { date: string; text: string; consequence: string; source: string } }) {
  const due = new Date(`${d.date}T23:59:59Z`);
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  const when = due.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const left = days > 1 ? `${days} days left` : days === 1 ? "1 day left" : days === 0 ? "today" : `passed ${-days} day${days === -1 ? "" : "s"} ago`;
  return (
    <div className={`deadline ${days < 0 ? "passed" : days <= 14 ? "soon" : ""}`} title={`${d.consequence} Source: ${d.source}. Policy snapshot ${policy.meta.snapshotDate}.`}>
      <span className="deadline-label">{d.text}</span>
      <span className="deadline-date">{when} · {left}</span>
    </div>
  );
}
