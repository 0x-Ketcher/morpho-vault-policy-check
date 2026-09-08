/**
 * Generates the human-readable tables from the same JSON the app runs on:
 *   docs/POLICY.md        <- config/policy.json
 *   docs/ADDRESS_BOOK.md  <- labels/registry.json + labels/atlas.json + labels/curators.json
 *   docs/SAFES.md         <- labels/safes.json (owners and thresholds as read on-chain, cross-checked with the Safe service)
 * `--check` exits 1 if a committed file differs from what would be generated (used by CI).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadPolicy, loadLabels, loadJson, p } from "../src/node/load.ts";
import { PRIME_CONTROLLED_ROLES } from "../src/sources/labels/index.ts";

const policy = loadPolicy();
const labels = loadLabels(policy);
const providers = loadJson<{ chains: Record<string, { name: string; explorer: string }> }>("config/providers.json");
const chainName = (id: number) => providers.chains[String(id)]?.name ?? `chain ${id}`;
const check = process.argv.includes("--check");
const esc = (s: string | undefined | null) => (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function policyDoc(): string {
  const L: string[] = [];
  L.push("# Policy table", "", "Generated from `config/policy.json` by `npm run gen:docs`. Do not edit by hand; edit the JSON and regenerate.", "");
  L.push(`Policy: ${policy.meta.policy}`, `Source: ${policy.meta.policyUrl}`, `Snapshot: ${policy.meta.snapshotDate}; policy last changed: ${policy.meta.policyLastChanged}`, "");
  if (policy.meta.deadline) L.push(`Deadline: ${policy.meta.deadline.text}: ${policy.meta.deadline.date}. ${policy.meta.deadline.consequence} Source: ${policy.meta.deadline.source}`, "");
  for (const n of policy.meta.notes) L.push(`- ${n}`);
  L.push("", "## Checks", "", "| # | Check | Rule | Severity when violated | Policy source |", "|---|---|---|---|---|");
  L.push(`| C1 | Vault version and factory | Report only: Vault V2 or MetaMorpho v1.1; factory deployment confirmed | FAIL only if the factory denies the vault | Proposal #11 setup |`);
  L.push(`| C2 | Chain | ${policy.chains.accepted.map((c) => `${c.name} (${c.id})`).join(", ")} | ${policy.chains.severityWhenNotAccepted} | ${esc(policy.chains.source)} |`);
  L.push(`| C3 | Loan asset | address allow-list per chain (below) | ${policy.loanAssets.severityWhenNotAccepted} | ${esc(policy.loanAssets.source)} |`);
  L.push(`| C4 | Collateral, LLTV and IRM | accepted collateral within max LLTV, and the accepted interest rate model, for every market with an allocation or a cap | not accepted with allocation ${policy.collateral.severity.notAcceptedWithAllocation}; cap-only ${policy.collateral.severity.notAcceptedCapOnly}; LLTV above max ${policy.collateral.severity.lltvAboveMaxWithAllocation}/${policy.collateral.severity.lltvAboveMaxCapOnly}; symbol match but unknown address ${policy.collateral.severity.symbolMatchesAddressUnknown}; wrong IRM ${policy.irm.severity.notAcceptedWithAllocation}/${policy.irm.severity.notAcceptedCapOnly} | ${esc(policy.collateral.source)} ${esc(policy.irm.source)} |`);
  L.push(`| C5 | Owner | ${esc(policy.roles.owner)} | FAIL / WARN as stated | ${esc(policy.roles.source)} |`);
  L.push(`| C6 | Curator | ${esc(policy.roles.curator)} | FAIL / WARN as stated | ${esc(policy.roles.source)} |`);
  L.push(`| C7 | Sentinel / Guardian | ${esc(policy.roles.sentinel)} | FAIL / WARN as stated | ${esc(policy.roles.source)} |`);
  L.push(`| C8 | Allocators | ${esc(policy.roles.allocator)} | INFO | ${esc(policy.roles.source)} |`);
  L.push(`| C9 | Timelocks | per-function minimums (below) | ${policy.timelocks.severityBelowMinimum} | ${esc(policy.timelocks.source)} |`);
  L.push(`| C10 | Oracles | ${esc(policy.oracle.source)} | ${policy.oracle.status} | policy section 'Collateral pricing / oracle' |`);
  L.push(`| C11 | Fees | ${esc(policy.fees.source)} | ${policy.fees.status} | policy section 'Fees' |`);
  L.push(`| C12 | Sky exposure and Liquidity Layer onboarding | ${esc(policy.exposure.source)} | ${policy.exposure.status} | context |`);
  L.push("", "## Accepted loan assets", "", "| Chain | Symbol | Address | Verified via |", "|---|---|---|---|");
  for (const [cid, list] of Object.entries(policy.loanAssets.accepted)) for (const a of list) L.push(`| ${chainName(Number(cid))} | ${a.symbol} | ${a.address} | ${esc(a.verified)} |`);
  L.push("", "## Accepted collateral", "", "| Chain | Symbol | Policy name | Max LLTV | Address | Verified via |", "|---|---|---|---|---|---|");
  for (const [cid, list] of Object.entries(policy.collateral.accepted)) for (const a of list) L.push(`| ${chainName(Number(cid))} | ${a.symbol} | ${a.policyName ?? a.symbol} | ${((a.maxLltv ?? 0) * 100).toFixed(1)}% | ${a.address} | ${esc(a.verified)} |`);
  L.push("", `Known non-accepted collateral seen in Sky-related vaults: ${policy.collateral.knownNotAccepted.join(", ")}.`, "");
  L.push("## Accepted interest rate model", "", policy.irm.source, "", "| Chain | Name | Address | Verified via |", "|---|---|---|---|");
  for (const [cid, list] of Object.entries(policy.irm.accepted)) for (const a of list) L.push(`| ${chainName(Number(cid))} | ${a.name} | ${a.address} | ${esc(a.verified)} |`);
  L.push("");
  L.push("## Timelock minimums (Vault V2)", "", "| Scope | Function | Policy label | Minimum | Abdication satisfies | Note |", "|---|---|---|---|---|---|");
  for (const f of policy.timelocks.vault) L.push(`| vault | \`${f.function}\` | ${f.label} | ${f.minDays}d | ${f.abdicationSatisfies ? "yes" : "no"} | ${esc(f.note)} |`);
  for (const f of policy.timelocks.adapter) L.push(`| adapter | \`${f.function}\` | ${f.label} | ${f.minDays}d | ${f.abdicationSatisfies ? "yes" : "no"} | ${esc(f.note)} |`);
  for (const f of policy.timelocks.informational) L.push(`| vault | \`${f.function}\` | ${f.label} | none | - | informational |`);
  L.push("", policy.timelocks.note, "", "## OEA identity", "", policy.oea.note, "", `OEA entity names recognised in Atlas text: ${policy.oea.entities.join(", ")}.`, "", `Primes: ${policy.primes.names.join(", ")}. Morpho curator registry names treated as Prime-side: ${Object.entries(policy.primes.curatorRegistryAliases).map(([k, v]) => `${k} -> ${v}`).join(", ")}.`, "");
  return L.join("\n");
}

function addressBook(): string {
  const L: string[] = [];
  const reg = labels.data.registry, atlas = labels.data.atlas, cur = labels.data.curators;
  L.push("# Address book", "", "Generated from `labels/*.json` by `npm run gen:docs`. Every row cites the public source it came from.", "");
  L.push(`Registries read at: ${Object.entries((reg?.meta.commits as Record<string, string>) ?? {}).map(([r, c]) => `${r}@${c.slice(0, 8)}`).join(", ")} (${String(reg?.meta.generatedAt ?? "").slice(0, 10)})`);
  L.push(`Atlas read at: ${Object.entries((atlas?.meta.commits as Record<string, string>) ?? {}).map(([r, c]) => `${r}@${c.slice(0, 8)}`).join(", ")}; ${atlas?.meta.files} files, ${atlas?.entries.length} address mentions`);
  L.push(`Morpho curator registry: ${cur?.entries.length} curators, read ${String(cur?.meta.generatedAt ?? "").slice(0, 10)}`, "");
  const chains = [...new Set([...(reg?.entries ?? []).map((e) => e.chainId), ...(cur?.entries ?? []).flatMap((c) => c.addresses.map((a) => a.chainId))])].sort((a, b) => a - b);
  const sections: [string, (role: string) => boolean][] = [
    ["Prime governance and agents", (r) => ["subproxy", "executor", "almProxy", "almRateLimits", "almController"].includes(r)],
    ["Morpho vaults", (r) => r === "morphoVault"],
    ["Multisigs", (r) => ["morphoCurator", "morphoGuardian", "multisig", "oeaOperator"].includes(r)],
    ["Morpho infrastructure", (r) => ["morphoBlue", "morphoV2Factory", "metaMorphoFactory", "morphoAdapterRegistry"].includes(r)],
    ["Tokens", (r) => r === "token"],
  ];
  for (const cid of chains) {
    L.push(`## ${chainName(cid)} (${cid})`, "");
    for (const [title, pred] of sections) {
      const rows = (reg?.entries ?? []).filter((e) => e.chainId === cid && pred(e.role)).sort((a, b) => a.prime.localeCompare(b.prime) || a.constant.localeCompare(b.constant));
      if (!rows.length) continue;
      L.push(`### ${title}`, "", "| Address | Prime | Constant | Role | Source |", "|---|---|---|---|---|");
      for (const e of rows) L.push(`| ${e.address} | ${e.prime} | ${e.constant} | ${e.role} | [${e.file} L${e.line}](${e.url}) |`);
      L.push("");
    }
    const curRows = (cur?.entries ?? []).flatMap((c) => c.addresses.filter((a) => a.chainId === cid).map((a) => ({ c, a }))).sort((x, y) => x.c.name.localeCompare(y.c.name));
    if (curRows.length) {
      L.push("### Morpho curator registry", "", "| Address | Curator | Verified | Also in registries as |", "|---|---|---|---|");
      for (const { c, a } of curRows) L.push(`| ${a.address} | ${c.name} | ${c.verified ? "yes" : "no"} | ${labels.registryEntries(a.address, cid).map((e) => `${e.prime}:${e.constant}`).join(", ") || "-"} |`);
      L.push("");
    }
  }
  const roleMentions = (atlas?.entries ?? []).filter((e) => e.roleHint && ["curator", "guardian", "sentinel", "allocator", "owner", "executor", "proxy", "multisig", "relayer", "freezer"].includes(e.roleHint)).sort((a, b) => (a.prime ?? "").localeCompare(b.prime ?? "") || a.article.localeCompare(b.article));
  L.push("## Atlas role mentions (chain not stated by the Atlas)", "", "| Address | Prime article | Role hint | Entity hint | Article | Line |", "|---|---|---|---|---|---|");
  for (const e of roleMentions) L.push(`| ${e.address} | ${e.prime ?? "-"} | ${e.roleHint} | ${esc(e.entityHint) || "-"} | ${e.article} - ${esc(e.title)} | [L${e.line}](${e.url}) |`);
  L.push("");
  return L.join("\n");
}

function safesDoc(): string {
  const L: string[] = [];
  const safes = labels.data.safes;
  L.push("# Safe owners", "", "Generated from `labels/safes.json` by `npm run gen:docs`; the data is produced by `npm run read:safes` (on-chain getOwners/getThreshold at a pinned block, cross-checked with the Safe Transaction Service).", "", "Owner addresses are listed as read. Signer identities are not public; a label appears only where a public source names the address.", "");
  L.push(`Read at: ${String(safes?.meta.generatedAt ?? "").slice(0, 19)}Z; ${safes?.entries.length ?? 0} Safes`, "");
  const byChain = new Map<number, typeof safes extends undefined ? never : NonNullable<typeof safes>["entries"]>();
  for (const e of safes?.entries ?? []) { if (!byChain.has(e.chainId)) byChain.set(e.chainId, []); byChain.get(e.chainId)!.push(e); }
  for (const [cid, rows] of [...byChain.entries()].sort((a, b) => a[0] - b[0])) {
    L.push(`## ${chainName(cid)} (${cid})`, "", "| Safe | Label | Threshold | Version | Owners | Service agrees | Block |", "|---|---|---|---|---|---|---|");
    for (const e of rows.sort((a, b) => (a.label ?? "zz").localeCompare(b.label ?? "zz") || a.address.localeCompare(b.address))) {
      const owners = (e.owners ?? []).map((o) => { const att = labels.attribute(o, cid); const nested = labels.safeOwners(o, cid); return `${o}${att.entity ? ` (${att.entity})` : nested?.isSafe ? ` (Safe ${nested.threshold}/${nested.owners?.length})` : ""}`; }).join("<br>");
      L.push(`| ${e.address} | ${esc(e.label) || "-"} | ${e.threshold}/${e.owners?.length ?? 0} | ${e.version ?? "-"} | ${owners} | ${e.serviceAgrees === null || e.serviceAgrees === undefined ? "n/a" : e.serviceAgrees ? "yes" : "NO"} | ${e.block ?? "-"} |`);
    }
    L.push("");
  }
  return L.join("\n");
}

const outputs: [string, string][] = [["docs/POLICY.md", policyDoc()], ["docs/ADDRESS_BOOK.md", addressBook()], ["docs/SAFES.md", safesDoc()]];
let stale = false;
for (const [rel, content] of outputs) {
  const prev = existsSync(p(rel)) ? readFileSync(p(rel), "utf8") : "";
  const same = prev === content + "\n";
  if (!check) writeFileSync(p(rel), content + "\n");
  console.log(`${rel}: ${same ? "unchanged" : check ? "STALE" : "written"} (${content.split("\n").length} lines)`);
  if (!same) stale = true;
}
if (check && stale) { console.log("generated docs are out of date: run npm run gen:docs"); process.exit(1); }
