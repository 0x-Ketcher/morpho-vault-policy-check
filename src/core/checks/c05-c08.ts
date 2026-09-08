import type { CheckDef, CheckContext } from "./helpers.ts";
import { pick, result, worst, describe, attributeSafe, leafSigners, isPrimeGovernance, short, ZERO } from "./helpers.ts";
import type { Status, Citation, SafeInfo } from "../types.ts";

const safeOf = (ctx: CheckContext, addr: string): SafeInfo | undefined => (ctx.a ?? ctx.b).safes[addr.toLowerCase()];
const safeShape = (s?: SafeInfo) => (!s ? "unknown" : s.unavailable ? "structure unavailable from this method" : !s.isContract ? "EOA" : !s.isSafe ? "contract, not a Safe" : `Safe ${s.threshold}/${s.owners?.length}`);
/** structure per method; a method that could not read it (service down) yields undefined, which counts as single-source, not as a disagreement */
const safePick = (ctx: CheckContext, label: string, addr: string) =>
  pick(ctx, `${label} Safe structure`, (s) => { const x = s.safes[addr.toLowerCase()]; if (!x || x.unavailable) return undefined; return { isSafe: x.isSafe, threshold: x.threshold ?? null, owners: (x.owners ?? []).map((o) => o.toLowerCase()).sort() }; }, (v) => (v ? (v.isSafe ? `${v.threshold}/${v.owners.length}: ${v.owners.map(short).join(", ")}` : "not a Safe") : "unavailable"));

export const c05Owner: CheckDef = {
  id: "C5", title: "Owner",
  evaluate: (ctx) => {
    const owner = pick(ctx, "owner()", (s) => s.owner, (v) => v);
    const structure = safePick(ctx, "owner", owner.value);
    const safe = safeOf(ctx, owner.value);
    const att = attributeSafe(ctx, owner.value, safe);
    const citations: Citation[] = [...att.citations];
    let status: Status; let summary: string; const details: string[] = [`Owner ${owner.value}: ${safeShape(safe)}; label: ${describe(att)}${att.via ? ` ${att.via}` : ""}`];
    if (owner.value === ZERO) { status = "FAIL"; summary = "No owner set."; }
    else if (isPrimeGovernance(att)) { status = "PASS"; summary = `Owner is ${att.prime} governance (${att.roles.filter((r) => r === "subproxy" || r === "executor").join("/")}).`; }
    else if (safe?.isSafe) {
      const owners = safe.owners ?? [];
      const gov = owners.map((o) => ({ o, att: ctx.labels.attribute(o, ctx.b.chainId) })).filter((x) => isPrimeGovernance(x.att));
      for (const g of gov) citations.push(...g.att.citations);
      for (const o of owners) details.push(`  signer ${o}: ${describe(ctx.labels.attribute(o, ctx.b.chainId))}`);
      if (gov.length > 0 && safe.threshold === owners.length) { status = "WARN"; summary = `Owner is a ${safe.threshold}/${owners.length} Safe that includes ${gov[0].att.prime} governance; the Prime holds a veto but not sole control, the policy wants the Prime governance address alone.`; }
      else if (gov.length > 0) { status = "FAIL"; summary = `Owner is a ${safe.threshold}/${owners.length} Safe that includes ${gov[0].att.prime} governance but the Prime cannot veto (threshold below the signer count).`; }
      else { status = "FAIL"; summary = `Owner is a ${safe.threshold}/${owners.length} Safe with no Prime governance signer${att.entity ? ` (${att.entity})` : ""}: an external party owns the vault.`; }
    }
    else if (att.side === "prime") { status = "WARN"; summary = `Owner is a ${att.prime} address (${att.roles.join(", ")}) but not the governance SubProxy or executor.`; }
    else { status = "FAIL"; summary = `Owner is ${att.entity ? att.entity : "an address no public source attributes"}, a ${safeShape(safe)}: an external party owns the vault.`; }
    return result("C5", "Owner", ctx.policy.roles.owner, status, summary, [owner, structure], details, citations);
  },
};

type Class = "external" | "prime" | "oea" | "unknown";
function classOf(ctx: CheckContext, addr: string): { cls: Class; att: ReturnType<typeof attributeSafe> } {
  const att = attributeSafe(ctx, addr, safeOf(ctx, addr));
  return { cls: att.side === "unknown" ? "unknown" : att.side, att };
}

export const c06Curator: CheckDef = {
  id: "C6", title: "Curator",
  evaluate: (ctx) => {
    const curator = pick(ctx, "curator()", (s) => s.curator, (v) => v);
    const structure = safePick(ctx, "curator", curator.value);
    const safe = safeOf(ctx, curator.value);
    const self = classOf(ctx, curator.value);
    const citations: Citation[] = [...self.att.citations];
    const details: string[] = [`Curator ${curator.value}: ${safeShape(safe)}; label: ${describe(self.att)}${self.att.via ? ` ${self.att.via}` : ""}`];
    let status: Status; let summary: string;
    if (curator.value === ZERO) { status = "FAIL"; summary = "No curator set."; }
    else if (!safe?.isSafe) {
      status = "FAIL";
      summary = self.cls === "external" ? `Curator is ${self.att.entity} directly (${safeShape(safe)}), not a 2/2 Safe with the OEA.` : self.cls === "unknown" ? `Curator is ${safeShape(safe)} that no public source attributes; not the 2/2 model.` : `Curator is a ${self.cls} ${safeShape(safe)}, not the 2/2 model.`;
    } else {
      const owners = safe.owners ?? [];
      const classes = owners.map((o) => ({ o, ...classOf(ctx, o) }));
      for (const c of classes) { citations.push(...c.att.citations); details.push(`  signer ${c.o}: ${safeShape(safe.ownerSafes?.[c.o.toLowerCase()])}; ${describe(c.att)}${c.att.via ? ` ${c.att.via}` : ""}`); }
      const E = classes.filter((c) => c.cls === "external"), P = classes.filter((c) => c.cls === "prime"), O = classes.filter((c) => c.cls === "oea"), U = classes.filter((c) => c.cls === "unknown");
      const two = safe.threshold === 2 && owners.length === 2;
      if (E.length + P.length + O.length > 0) {
        if (two && E.length === 1 && O.length === 1 && !O[0].att.via) { status = "PASS"; summary = `2/2 Safe between external curator ${E[0].att.entity} and the OEA (${O[0].att.entity}).`; }
        else if (two && E.length === 1 && O.length === 1) { status = "WARN"; summary = `2/2 Safe between external curator ${E[0].att.entity} and ${short(O[0].o)}, attributed to the OEA (${O[0].att.entity}) only ${O[0].att.via}; a direct public label is needed for PASS.`; }
        else if (two && E.length === 1 && U.length === 1) { status = "WARN"; summary = `2/2 Safe between external curator ${E[0].att.entity} and ${short(U[0].o)} (${safeShape(safe.ownerSafes?.[U[0].o.toLowerCase()])}), whose OEA identity no public source attests.`; }
        else if (two && E.length === 1 && P.length === 1) { status = "WARN"; summary = `2/2 Safe between external curator ${E[0].att.entity} and ${P[0].att.prime} governance instead of the OEA; policy call open.`; }
        else if (E.length === 0) { status = "WARN"; summary = `Curator Safe ${safe.threshold}/${owners.length} is ${O.length ? "OEA" : "Prime"}-side only (${[...O, ...P].map((x) => x.att.entity).filter(Boolean).join(", ") || "labeled signers"}), not the 2/2 with an external curator; open question whether the 2/2 rule applies to Prime- or OEA-self-curated vaults.`; }
        else if (O.length + P.length === 0) { status = "FAIL"; summary = `Curator Safe ${safe.threshold}/${owners.length} has only external signers (${E.map((x) => x.att.entity).join(", ")}); no OEA or Prime participation.`; }
        else { status = "WARN"; summary = `Curator Safe ${safe.threshold}/${owners.length} mixes external (${E.length}), Prime (${P.length}), OEA (${O.length}) and unlabeled (${U.length}) signers; structure differs from the 2/2 model.`; }
      } else {
        // every signer unlabeled: fall back to what public sources say about the Safe itself
        if (self.cls === "external") { status = "FAIL"; summary = `Curator is ${self.att.entity}'s own ${safeShape(safe)}${self.att.via ? ` (${self.att.via})` : ""}: the external party alone, no OEA co-signer.`; }
        else if (self.cls === "oea" || self.cls === "prime") { status = "WARN"; summary = `Curator is a ${safeShape(safe)} controlled by ${self.cls === "oea" ? `the OEA, ${self.att.entity}${self.att.prime ? `, also listed as ${self.att.prime}'s curator multisig` : ""}` : self.att.entity ?? "the Prime"}${self.att.via ? ` (${self.att.via})` : ""}: self-curated rather than the 2/2 with an external curator; policy call open.`; }
        else { status = "FAIL"; summary = `Curator is a ${safeShape(safe)} that no public source attributes and whose signers are all unlabeled; no attested OEA or Prime participation.`; }
      }
    }
    return result("C6", "Curator", ctx.policy.roles.curator, status, summary, [curator, structure], details, citations);
  },
};

export const c07Sentinel: CheckDef = {
  id: "C7", title: "Sentinel / Guardian",
  evaluate: (ctx) => {
    const v1 = ctx.b.version === "v1.1";
    const seat = v1 ? "guardian" : "sentinel";
    const sev = ctx.policy.roles.sentinelSeverity ?? { curatorItself: "FAIL" as Status, thirdPartyExtra: "WARN" as Status };
    const list = pick(ctx, v1 ? "guardian()" : "sentinels", (s) => (v1 ? [s.guardian ?? ZERO].filter((x) => x !== ZERO) : s.sentinels).map((x) => x.toLowerCase()).sort(), (v) => (v.length ? v.join(", ") : "none"));
    const structures = list.value.map((s) => safePick(ctx, `${seat} ${short(s)}`, s));
    const src = ctx.a ?? ctx.b;
    const curatorAddr = src.curator.toLowerCase();
    const curatorSafe = safeOf(ctx, curatorAddr);
    const curatorOwners = new Set((curatorSafe?.owners ?? []).map((o) => o.toLowerCase()));
    const curatorSigners = leafSigners(curatorSafe);
    const citations: Citation[] = []; const details: string[] = [];
    type Kind = "oea" | "oea-candidate" | "prime-extra" | "curator-itself" | "third-party-extra";
    const rows: { addr: string; kind: Kind; status: Status | null; why: string }[] = [];
    for (const s of list.value) {
      const safe = safeOf(ctx, s);
      const att = attributeSafe(ctx, s, safe);
      citations.push(...att.citations);
      const shape = safeShape(safe);
      const shared = [...leafSigners(safe)].filter((x) => curatorSigners.has(x));
      const label = att.entity ? `${att.entity}${att.via ? `, ${att.via}` : ""}` : "unlabeled";
      let row: { addr: string; kind: Kind; status: Status | null; why: string };
      if (s === curatorAddr) row = { addr: s, kind: "curator-itself", status: sev.curatorItself, why: `is the curator address itself (${shape}); the curator may not hold a ${seat} seat` };
      else if (curatorOwners.has(s)) row = { addr: s, kind: "third-party-extra", status: sev.thirdPartyExtra, why: `is a signer of the curator Safe (${label}, ${shape}); a third party in a ${seat} seat, open question for BA` };
      else if (att.side === "external") row = { addr: s, kind: "third-party-extra", status: sev.thirdPartyExtra, why: `is the external curator's address (${label}, ${shape}); a third party in a ${seat} seat, open question for BA` };
      else if (safe?.isSafe && att.side !== "oea" && shared.length > 0) row = { addr: s, kind: "third-party-extra", status: sev.thirdPartyExtra, why: `${shape} sharing ${shared.length} signer(s) with the curator Safe (${label}); a curator-linked third party in a ${seat} seat, open question for BA` };
      else if (safe?.isSafe && att.side === "oea" && !att.via && shared.length === 0) row = { addr: s, kind: "oea", status: "PASS", why: `OEA Safe (${label}), ${shape}, signers disjoint from the curator's` };
      else if (safe?.isSafe && att.side === "oea" && shared.length === 0) row = { addr: s, kind: "oea-candidate", status: "WARN", why: `${shape} attributed to the OEA (${label}); signers disjoint from the curator's; a direct public label is needed for PASS` };
      else if (safe?.isSafe && att.side === "oea") row = { addr: s, kind: "oea-candidate", status: "WARN", why: `OEA Safe (${label}), ${shape}, but shares ${shared.length} signer(s) with the curator Safe; the policy requires a separate signer set` };
      else if (att.side === "prime") row = { addr: s, kind: "prime-extra", status: null, why: `Prime-owned (${label}), ${shape}; allowed as an additional ${seat}` };
      else if (safe?.isSafe) row = { addr: s, kind: "oea-candidate", status: "WARN", why: `${shape} with signers disjoint from the curator's and from every labeled Safe: OEA-shaped, identity not publicly attested` };
      else row = { addr: s, kind: "third-party-extra", status: sev.thirdPartyExtra, why: `${shape} that no public source attributes; a monitoring solution would look like this, a public label is needed` };
      rows.push(row);
      details.push(`${seat} ${s}: ${row.why}`);
      for (const o of safe?.owners ?? []) details.push(`  signer ${o}: ${describe(ctx.labels.attribute(o, ctx.b.chainId))}`);
    }
    // mandatory condition: one OEA seat with separate signers
    const oea = rows.filter((r) => r.kind === "oea"), candidates = rows.filter((r) => r.kind === "oea-candidate");
    const mandatory: Status = oea.length ? "PASS" : candidates.length ? "WARN" : "FAIL";
    const violations = rows.filter((r) => r.kind === "curator-itself"), extras = rows.filter((r) => r.kind === "third-party-extra"), primes = rows.filter((r) => r.kind === "prime-extra");
    const status = worst([mandatory, ...violations.map((r) => r.status!), ...extras.map((r) => r.status!)]);
    const parts: string[] = [];
    parts.push(rows.length === 0 ? `No ${seat} set; the OEA ${seat} is mandatory.` : mandatory === "PASS" ? `OEA ${seat} with separate signers in place (${short(oea[0].addr)}).` : mandatory === "WARN" ? `OEA ${seat} not publicly attested: ${candidates.map((r) => `${short(r.addr)} ${r.why}`).join("; ")}.` : `No OEA ${seat}.`);
    if (violations.length) parts.push(`Curator in a ${seat} seat: ${violations.map((r) => short(r.addr)).join(", ")}.`);
    if (extras.length) parts.push(`Third-party ${seat}${extras.length > 1 ? "s" : ""} ${extras.map((r) => short(r.addr)).join(", ")}: open question for BA, see below.`);
    if (primes.length) parts.push(`Prime-owned ${seat}${primes.length > 1 ? "s" : ""} ${primes.map((r) => short(r.addr)).join(", ")}: allowed.`);
    return result("C7", "Sentinel / Guardian", ctx.policy.roles.sentinel, status, parts.join(" "), [list, ...structures], details, citations);
  },
};

export const c08Allocators: CheckDef = {
  id: "C8", title: "Allocators",
  evaluate: (ctx) => {
    const list = pick(ctx, "allocators", (s) => s.allocators.map((x) => x.toLowerCase()).sort(), (v) => (v.length ? v.join(", ") : "none"));
    const citations: Citation[] = []; const details: string[] = [];
    for (const a of list.value) {
      const att = attributeSafe(ctx, a, safeOf(ctx, a));
      citations.push(...att.citations);
      details.push(`${a}: ${safeShape(safeOf(ctx, a))}; ${describe(att)}${att.via ? ` ${att.via}` : ""}`);
    }
    const summary = list.value.length === 0 ? "No allocators set." : `${list.value.length} allocator(s): ${details.map((d) => d.split(";")[1]?.trim() ?? "").join("; ")}`;
    return result("C8", "Allocators", ctx.policy.roles.allocator, "INFO", summary, [list], details, citations);
  },
};
