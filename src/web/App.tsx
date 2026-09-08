import { useEffect, useMemo, useState } from "react";
import { policy, providers, knownVaults, labels } from "./data.ts";
import { checkFreshness, type Freshness } from "./freshness.ts";
import { MorphoApi } from "../sources/morpho-api/client.ts";
import { checkVault, findCandidates, ETHERSCAN_MORPHO_CHAINS, type Deps } from "../pipeline.ts";
import { renderMarkdown } from "../core/render.ts";
import { fmtUsd } from "../core/checks/helpers.ts";
import type { Report, CheckResult, Status } from "../core/types.ts";

const STATUS_LABEL: Record<Status, string> = { PASS: "PASS", WARN: "WARN", FAIL: "FAIL", NA: "n/a", INFO: "info" };

export function App() {
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState<string>("auto");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ownKey, setOwnKey] = useState<string>(() => { try { return localStorage.getItem("etherscan-key") ?? ""; } catch { return ""; } });
  const [showSettings, setShowSettings] = useState(false);
  const [proxyAvailable, setProxyAvailable] = useState<boolean | null>(null);
  const [freshness, setFreshness] = useState<Freshness[] | null>(null);

  useEffect(() => {
    fetch("/api/health").then((r) => (r.ok ? r.json() : null)).then((d) => setProxyAvailable(!!d?.etherscan)).catch(() => setProxyAvailable(false));
    checkFreshness().then(setFreshness).catch(() => setFreshness(null));
    const params = new URLSearchParams(location.search);
    const a = params.get("address"), c = params.get("chain");
    if (a) { setAddress(a); if (c) setChain(c); }
  }, []);

  const deps = useMemo<Deps>(() => {
    const etherscan = ownKey
      ? { base: providers.etherscan.api, apiKey: ownKey, chains: ETHERSCAN_MORPHO_CHAINS }
      : proxyAvailable ? { base: `${location.origin}/api/etherscan`, chains: ETHERSCAN_MORPHO_CHAINS } : undefined;
    return { policy, providers, labels, api: new MorphoApi(providers.morphoApi), etherscan, log: (m) => setLog((l) => [...l, m]) };
  }, [ownKey, proxyAvailable]);

  async function run(addr = address, chainId = chain) {
    setRunning(true); setError(null); setReport(null); setLog([]);
    try {
      const cid = chainId === "auto" ? undefined : Number(chainId);
      let target = cid;
      if (target === undefined) {
        const found = await findCandidates(deps, addr.trim());
        if (found.length > 1) { setError(`This address is a Morpho vault on several chains: ${found.map((f) => `${f.network} (${f.chainId})`).join(", ")}. Pick the chain.`); setRunning(false); return; }
      }
      const r = await checkVault(deps, addr.trim(), target);
      setReport(r);
      const url = new URL(location.href); url.searchParams.set("address", r.vault.address); url.searchParams.set("chain", String(r.vault.chainId)); history.replaceState(null, "", url.toString());
    } catch (e) { setError((e as Error).message); }
    setRunning(false);
  }

  function download(name: string, text: string, type: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const behind = freshness?.filter((f) => f.behind) ?? [];

  return (
    <div className="page">
      <header>
        <div className="header-row">
          <h1>Morpho vault policy check</h1>
          {policy.meta.deadline && <Deadline d={policy.meta.deadline} />}
        </div>
        <p className="sub">Checks a Morpho vault against the <a href={policy.meta.policyUrl} target="_blank" rel="noreferrer">BA Labs Morpho Vaults v2 eligibility criteria</a>, twice: once from chain state through public nodes, once through the Morpho API. Labels come from public sources only: the Prime address registries, the Atlas and Morpho's curator registry. Disagreements between methods are shown, never resolved.</p>
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
          <select value="" onChange={(e) => { const v = knownVaults.vaults.find((x) => `${x.chainId}:${x.address}` === e.target.value); if (v) { setAddress(v.address); setChain(String(v.chainId)); void run(v.address, String(v.chainId)); } }}>
            <option value="">or pick a known Sky-related vault…</option>
            {knownVaults.vaults.map((v) => <option key={`${v.chainId}:${v.address}`} value={`${v.chainId}:${v.address}`}>{v.name} · {providers.chains[String(v.chainId)]?.name ?? v.chainId}</option>)}
          </select>
          <button className="ghost" onClick={() => setShowSettings((s) => !s)}>settings</button>
        </div>
        {showSettings && (
          <div className="settings">
            <label>Your own Etherscan API key (optional, stays in this browser only; used as a third, fallback on-chain provider)
              <input value={ownKey} onChange={(e) => { setOwnKey(e.target.value); try { localStorage.setItem("etherscan-key", e.target.value); } catch { /* ignore */ } }} placeholder="not set" spellCheck={false} />
            </label>
            <p className="muted">Server-side Etherscan fallback: {proxyAvailable === null ? "checking…" : proxyAvailable ? "available (key held by the server, never sent to the page)" : "not available on this deployment; public nodes only"}.</p>
          </div>
        )}
        {freshness && (
          <p className={`fresh ${behind.length ? "warn" : ""}`}>
            Label tables last changed {String(labels.meta().registry && (labels.meta().registry as { generatedAt: string }).generatedAt).slice(0, 10)}; sources checked now. {behind.length ? `${behind.length} source repo(s) have moved since: ${behind.map((b) => b.repo.split("/")[1]).join(", ")}. A newer label table may be waiting for review.` : freshness.every((f) => f.behind === false) ? "Every source repo is at the commit the labels were read from." : "Freshness of some sources could not be checked (GitHub API limit)."}
          </p>
        )}
      </section>

      {log.length > 0 && !report && <ul className="log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {error && <div className="error">{error}</div>}

      {report && (
        <section className="result">
          <div className="vault card">
            <div className="vault-head">
              <div>
                <h2>{report.vault.name ?? "Vault"} <span className="muted">{report.vault.symbol}</span></h2>
                <p className="mono">{report.vault.address} · {report.vault.chainName} ({report.vault.chainId}) · {report.vault.version === "v2" ? "Vault V2" : "MetaMorpho v1.1"} · {report.vault.asset} · {fmtUsd(report.vault.totalAssetsUsd)}</p>
              </div>
              <span className={`badge big ${report.worst}`}>worst: {STATUS_LABEL[report.worst]}</span>
            </div>
            <p className="muted">On-chain: block {report.providers.block}{report.providers.blockTimestamp ? ` (${new Date(report.providers.blockTimestamp * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC)` : ""} via {report.providers.primary}; second provider {report.providers.secondary ?? "none"}: {report.providers.secondaryStatus}; {report.providers.calls} reads. API: blue-api.morpho.org at {report.snapshotB.meta.fetchedAt.replace("T", " ").slice(0, 19)} UTC.</p>
            {report.providers.disagreements.length > 0 && <details><summary className="muted">provider notes ({report.providers.disagreements.length})</summary><ul className="small">{report.providers.disagreements.map((d, i) => <li key={i}>{d}</li>)}</ul></details>}
            <div className="actions">
              <button className="ghost" onClick={() => download(`${report.vault.chainId}-${report.vault.address}.json`, JSON.stringify(report, null, 2), "application/json")}>download JSON</button>
              <button className="ghost" onClick={() => download(`${report.vault.chainId}-${report.vault.address}.md`, renderMarkdown(report, policy.meta.deadline), "text/markdown")}>download Markdown</button>
            </div>
          </div>
          <div className="cards">{report.checks.map((c) => <Card key={c.id} c={c} />)}</div>
          <details className="notes"><summary>Method notes</summary>
            <ul className="small">
              {(report.snapshotA?.meta.notes ?? []).map((n, i) => <li key={`a${i}`}>on-chain: {n}</li>)}
              {report.snapshotB.meta.notes.map((n, i) => <li key={`b${i}`}>api: {n}</li>)}
              {!report.snapshotA && <li>No on-chain provider is configured for this chain: every value is API-only.</li>}
            </ul>
          </details>
        </section>
      )}

      <footer className="muted small">
        Policy snapshot {policy.meta.snapshotDate} (doc last changed {policy.meta.policyLastChanged}). Sources: {providers.morphoApi}, public JSON-RPC nodes, Safe Transaction Service, Prime address registries and the Atlas on GitHub. Nothing here is a legal or financial determination; it is a structural check with citations.
      </footer>
    </div>
  );
}

function Deadline({ d }: { d: { date: string; text: string; consequence: string; source: string } }) {
  const due = new Date(`${d.date}T23:59:59Z`);
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  const when = due.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const left = days > 1 ? `${days} days left` : days === 1 ? "1 day left" : days === 0 ? "today" : `passed ${-days} day${days === -1 ? "" : "s"} ago`;
  return (
    <div className={`deadline ${days < 0 ? "passed" : days <= 14 ? "soon" : ""}`} title={`${d.consequence} Source: ${d.source}`}>
      <span className="deadline-label">{d.text}</span>
      <span className="deadline-date">{when} · {left}</span>
    </div>
  );
}

function Card({ c }: { c: CheckResult }) {
  const [open, setOpen] = useState(c.status === "FAIL" || c.status === "WARN" || c.discrepancy);
  return (
    <div className={`card check ${c.status}`}>
      <div className="check-head" onClick={() => setOpen((o) => !o)}>
        <span className={`badge ${c.status}`}>{STATUS_LABEL[c.status]}</span>
        <h3>{c.id} · {c.title}</h3>
        <span className="tags">
          {c.discrepancy && <span className="tag disc">DISCREPANCY</span>}
          {!c.discrepancy && c.singleSource && <span className="tag">single source</span>}
          {!c.discrepancy && !c.singleSource && <span className="tag ok">methods agree</span>}
        </span>
      </div>
      <p className="summary">{c.summary}</p>
      {open && (
        <div className="body">
          <p className="req"><b>Requirement.</b> {c.requirement}</p>
          {c.evidence.length > 0 && (
            <table><thead><tr><th>method</th><th>value</th><th>read at</th></tr></thead><tbody>
              {c.evidence.map((e, i) => <tr key={i}><td>{e.method}<br /><span className="muted small">{e.label}</span></td><td className="mono small">{e.value}</td><td className="small">{e.block ? `block ${e.block}` : e.source ?? ""}</td></tr>)}
            </tbody></table>
          )}
          {c.discrepancies.length > 0 && <div className="disc-box"><b>Discrepancy between methods</b> (not auto-resolved; the verdict uses the on-chain value, a human decides):<ul>{c.discrepancies.map((d, i) => <li key={i} className="mono small">{d}</li>)}</ul></div>}
          {c.details.length > 0 && <ul className="details">{c.details.map((d, i) => <li key={i} className={d.startsWith("  ") ? "nested" : ""}>{d.trim()}</li>)}</ul>}
          {c.citations.length > 0 && <div className="cites"><b>Label sources</b><ul>{c.citations.map((x, i) => <li key={i} className="small">{x.source}: {x.url ? <a href={x.url} target="_blank" rel="noreferrer">{x.ref}</a> : x.ref}{x.entity ? ` → ${x.entity}` : ""}{x.nonPublic ? " [NON-PUBLIC]" : ""}</li>)}</ul></div>}
        </div>
      )}
    </div>
  );
}
