import type { Report, CheckResult } from "./types.ts";
import { fmtUsd } from "./checks/helpers.ts";

const badge = (s: string) => ({ PASS: "PASS", WARN: "WARN", FAIL: "FAIL", NA: "n/a", INFO: "INFO" })[s] ?? s;

export function renderMarkdown(r: Report): string {
  const L: string[] = [];
  L.push(`# ${r.vault.name ?? r.vault.address} - policy check`, "");
  L.push(`| | |`, `|---|---|`, `| Vault | ${r.vault.address} |`, `| Chain | ${r.vault.chainName} (${r.vault.chainId}) |`, `| Version | ${r.vault.version} |`, `| Asset | ${r.vault.asset ?? "?"} |`, `| Total assets | ${fmtUsd(r.vault.totalAssetsUsd)} |`, `| Worst graded status | ${badge(r.worst)} |`, `| Generated | ${r.generatedAt} |`);
  L.push(`| On-chain | block ${r.providers.block}${r.providers.blockTimestamp ? ` (${new Date(r.providers.blockTimestamp * 1000).toISOString()})` : ""} via ${r.providers.primary}; second provider: ${r.providers.secondary ?? "none"} (${r.providers.secondaryStatus}); ${r.providers.calls} reads |`);
  if (r.providers.disagreements.length) L.push(`| Provider notes | ${r.providers.disagreements.join("; ")} |`);
  L.push("", "## Summary", "", "| # | Check | Status | Two methods | Summary |", "|---|---|---|---|---|");
  for (const c of r.checks) L.push(`| ${c.id} | ${c.title} | ${badge(c.status)} | ${c.discrepancy ? "DISCREPANCY" : c.singleSource ? "single source" : "agree"} | ${c.summary.replace(/\|/g, "/")} |`);
  L.push("");
  for (const c of r.checks) L.push(...renderCheck(c));
  const notes = [...(r.snapshotA?.meta.notes ?? []).map((n) => `on-chain: ${n}`), ...r.snapshotB.meta.notes.map((n) => `api: ${n}`)];
  if (notes.length) L.push("## Method notes", "", ...notes.map((n) => `- ${n}`), "");
  return L.join("\n");
}

function renderCheck(c: CheckResult): string[] {
  const L: string[] = [];
  L.push(`## ${c.id} ${c.title}: ${badge(c.status)}${c.discrepancy ? " - DISCREPANCY between methods" : ""}`, "");
  L.push(c.summary, "", `Requirement: ${c.requirement}`, "");
  if (c.evidence.length) {
    L.push("| Method | Value | Read at |", "|---|---|---|");
    for (const e of c.evidence) L.push(`| ${e.method}${e.label ? ` (${e.label})` : ""} | ${e.value.replace(/\|/g, "/")} | ${e.block ? `block ${e.block}` : e.source ?? ""} |`);
    L.push("");
  }
  if (c.discrepancies.length) L.push("Discrepancies (not auto-resolved; on-chain takes precedence for the verdict, a human decides):", ...c.discrepancies.map((d) => `- ${d}`), "");
  if (c.details.length) L.push("Details:", ...c.details.map((d) => `- ${d}`), "");
  if (c.citations.length) L.push("Label sources:", ...c.citations.map((x) => `- ${x.source}: ${x.ref}${x.entity ? ` -> ${x.entity}` : ""}${x.url ? ` (${x.url})` : ""}${x.nonPublic ? " [NON-PUBLIC]" : ""}`), "");
  return L;
}

export function renderConsole(r: Report): string {
  const L: string[] = [];
  L.push(`${r.vault.name ?? ""} ${r.vault.address} | ${r.vault.chainName} | ${r.vault.version} | ${r.vault.asset ?? ""} | ${fmtUsd(r.vault.totalAssetsUsd)} | worst: ${r.worst}`);
  L.push(`on-chain block ${r.providers.block} via ${r.providers.primary}; second: ${r.providers.secondary ?? "none"} (${r.providers.secondaryStatus}); ${r.providers.calls} reads`);
  for (const c of r.checks) L.push(`  ${c.id.padEnd(4)} ${c.status.padEnd(4)} ${(c.discrepancy ? "DISCREPANCY " : c.singleSource ? "single-src  " : "            ")} ${c.title}: ${c.summary}`);
  return L.join("\n");
}
