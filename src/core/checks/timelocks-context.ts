import type { CheckDef } from "./helpers.ts";
import { pick, result, worst, fmtDays, fmtUsd, fmtUnits, describe, short } from "./helpers.ts";
import type { Status, Citation } from "../types.ts";

export const c09Timelocks: CheckDef = {
  id: "C7", title: "Timelocks",
  evaluate: (ctx) => {
    const p = ctx.policy.timelocks;
    if (ctx.b.version === "v1.1") {
      const tl = pick(ctx, "timelock()", (s) => s.timelockV1 ?? 0, (v) => fmtDays(v));
      return result("C7", "Timelocks", `V2 per-function minimums do not apply to MetaMorpho v1.1, which has one vault-wide timelock. ${p.source}`, "INFO", `v1.1 vault-wide timelock: ${fmtDays(tl.value)} (no per-function policy minimum for v1.1; reported for context).`, [tl]);
    }
    const picks = p.vault.map((f) => pick(ctx, f.label, (s) => (s.timelocks[f.function] ? { seconds: s.timelocks[f.function].seconds, abdicated: s.timelocks[f.function].abdicated } : null), (v) => (v ? `${fmtDays(v.seconds)}${v.abdicated ? " (abdicated)" : ""}` : "n/a")));
    const statuses: Status[] = []; const failing: string[] = []; const passing: string[] = []; const unread: string[] = [];
    p.vault.forEach((f, i) => {
      const v = picks[i].value; const min = (f.minDays ?? 0) * 86400;
      if (!v) { unread.push(`${f.label}: not readable`); return; }
      const ok = v.seconds >= min || (f.abdicationSatisfies && v.abdicated);
      statuses.push(ok ? "PASS" : p.severityBelowMinimum);
      (ok ? passing : failing).push(`${f.label}: ${fmtDays(v.seconds)}${v.abdicated ? ", abdicated" : ""} (minimum ${f.minDays}d${f.abdicationSatisfies ? " or abdicated" : ""})`);
    });
    for (const f of p.informational) { const v = (ctx.a ?? ctx.b).timelocks[f.function]; if (v) passing.push(`${f.label}: ${fmtDays(v.seconds)}`); }
    // adapters: on-chain only
    const src = ctx.a ?? ctx.b;
    for (const ad of src.adapters) {
      if (!ad.timelocks || Object.keys(ad.timelocks).length === 0) { unread.push(`adapter ${short(ad.address)}: adapter timelocks not readable by this method`); continue; }
      for (const f of p.adapter) {
        const s = ad.timelocks[f.function]; if (s === undefined) continue;
        const abd = ad.abdicated?.[f.function] ?? false; const min = (f.minDays ?? 0) * 86400;
        const ok = s >= min || (f.abdicationSatisfies && abd);
        statuses.push(ok ? "PASS" : p.severityBelowMinimum);
        (ok ? passing : failing).push(`${f.label.replace(/^Adapter: /, "")} on adapter ${short(ad.address)}: ${fmtDays(s)}${abd ? ", abdicated" : ""} (minimum ${f.minDays}d), on-chain only`);
      }
    }
    const status = statuses.length ? worst(statuses) : "NA";
    const details = [...(failing.length ? [`${failing.length} below the minimum:`, ...failing.map((l) => `  ${l}`)] : []), ...(passing.length ? [`${passing.length} at or above the minimum`, ...passing.map((l) => `  ${l}`)] : []), ...unread];
    const summary = status === "PASS" ? `All ${statuses.length} checked timelocks meet the policy minimums.` : failing.length ? `${failing.length} of ${statuses.length} timelocks below the policy minimum.` : "No timelocks readable.";
    return result("C7", "Timelocks", `Minimums per function (vault and adapter), abdication accepted where the policy says so. Below minimum = ${p.severityBelowMinimum}. ${p.source}`, status, summary, picks, details);
  },
};

export const c10Oracle: CheckDef = {
  id: "C10", title: "Oracles",
  evaluate: (ctx) => {
    const oracles = pick(ctx, "market oracles", (s) => s.markets.filter((m) => m.collateralToken).map((m) => ({ id: m.id, oracle: m.oracle })).sort((x, y) => x.id.localeCompare(y.id)), (v) => v.map((x) => `${x.id.slice(0, 10)}…: ${x.oracle ?? "none"}`).join("; "));
    const details = ctx.b.markets.filter((m) => m.collateralToken).map((m) => `${m.collateralSymbol ?? short(m.collateralToken!)}/${m.loanSymbol ?? ctx.b.asset.symbol ?? "?"} ${(m.lltv * 100).toFixed(1)}%: oracle ${m.oracle ?? "none"}${m.oracleType ? ` (${m.oracleType} per Morpho API)` : ""}`);
    return result("C10", "Oracles", `${ctx.policy.oracle.source} Reported for information until the oracle criteria are finalised.`, ctx.policy.oracle.status, details.length ? `${details.length} collateral market(s) with oracles reported; interim single-source Chainlink is acceptable per the policy snapshot.` : "No collateral markets.", [oracles], details);
  },
};

export const c11Fees: CheckDef = {
  id: "C11", title: "Fees",
  evaluate: (ctx) => {
    const v1 = ctx.b.version === "v1.1";
    const pct = (x?: number | null) => (x === undefined || x === null ? "n/a" : `${(x * 100).toFixed(2)}%`);
    const near = (a?: number | null, b?: number | null) => (a ?? 0) - (b ?? 0) < 1e-6 && (b ?? 0) - (a ?? 0) < 1e-6;
    const addrEq = (a?: string | null, b?: string | null) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
    const picks = v1
      ? [pick(ctx, "fee", (s) => s.fees.feeV1 ?? null, pct, { tolerance: near }), pick(ctx, "fee recipient", (s) => s.fees.feeRecipientV1 ?? null, (a) => a ?? "none", { tolerance: addrEq })]
      : [
        pick(ctx, "performance fee", (s) => s.fees.performanceFee ?? null, pct, { tolerance: near }),
        pick(ctx, "management fee", (s) => s.fees.managementFee ?? null, pct, { tolerance: near }),
        pick(ctx, "performance fee recipient", (s) => s.fees.performanceFeeRecipient ?? null, (a) => a ?? "none", { tolerance: addrEq }),
        pick(ctx, "management fee recipient", (s) => s.fees.managementFeeRecipient ?? null, (a) => a ?? "none", { tolerance: addrEq }),
      ];
    const src = ctx.a ?? ctx.b; const citations: Citation[] = []; const details: string[] = [];
    const who = (a?: string | null) => { if (!a || /^0x0{40}$/.test(a)) return "none"; const att = ctx.labels.attribute(a, ctx.b.chainId); citations.push(...att.citations); return `${a} (${describe(att)})`; };
    if (v1) details.push(`fee: ${pct(src.fees.feeV1)} to ${who(src.fees.feeRecipientV1)}`, `skim recipient: ${who(src.fees.skimRecipient)}`);
    else details.push(`performance fee: ${pct(src.fees.performanceFee)} to ${who(src.fees.performanceFeeRecipient)}`, `management fee: ${pct(src.fees.managementFee)} to ${who(src.fees.managementFeeRecipient)}`);
    return result("C11", "Fees", `${ctx.policy.fees.source} Reported for information.`, ctx.policy.fees.status, details.join("; "), picks, details, citations);
  },
};

export const c12Exposure: CheckDef = {
  id: "C12", title: "Sky exposure and Liquidity Layer onboarding",
  evaluate: (ctx) => {
    const dec = ctx.b.asset.decimals, sym = ctx.b.asset.symbol;
    const positions = pick(ctx, "Prime ALM proxy positions (asset units)", (s) => s.exposure.map((e) => ({ prime: e.prime, proxy: e.almProxy.toLowerCase(), assets: e.assets })).sort((x, y) => x.proxy.localeCompare(y.proxy)), (v) => v.map((e) => `${e.prime} ${short(e.proxy)}: ${fmtUnits(e.assets, dec, sym)}`).join("; ") || "none", {
      tolerance: (a, b) => a.length === b.length && a.every((x, i) => { const y = b[i]; const xa = Number(x.assets), ya = Number(y.assets); return x.proxy === y.proxy && (Math.abs(xa - ya) <= Math.max(1, 0.005 * Math.max(xa, ya))); }),
    });
    const details: string[] = []; const citations: Citation[] = [];
    const src = ctx.a ?? ctx.b;
    let total = 0;
    for (const e of src.exposure) {
      const usd = e.assetsUsd ?? ctx.b.exposure.find((x) => x.almProxy.toLowerCase() === e.almProxy.toLowerCase())?.assetsUsd;
      if (usd) total += usd;
      const att = ctx.labels.attribute(e.almProxy, ctx.b.chainId); citations.push(...att.citations);
      let line = `${e.prime} ${e.almProxyLabel} ${e.almProxy}: ${fmtUnits(e.assets, dec, sym)}${usd !== undefined ? ` (${fmtUsd(usd)})` : ""}`;
      if (e.rateLimits) {
        const d = e.rateLimits.deposit;
        const perDay = d && dec !== undefined ? fmtUnits((BigInt(d.slope) * 86400n).toString(), dec, sym) : "n/a";
        line += e.rateLimits.onboarded ? `; Liquidity Layer: onboarded (deposit limit max ${fmtUnits(d?.maxAmount, dec, sym)}, ${perDay}/day; ${e.rateLimits.label} ${short(e.rateLimits.contract)}) [on-chain only]` : `; Liquidity Layer: not onboarded (no deposit rate-limit key on ${e.rateLimits.label} ${short(e.rateLimits.contract)}) [on-chain only]`;
      } else line += "; Liquidity Layer: rate limits not read by this method";
      details.push(line);
    }
    const onboarded = src.exposure.some((e) => e.rateLimits?.onboarded);
    const ll = onboarded ? "Onboarded on the Liquidity Layer." : "Not onboarded on the Liquidity Layer.";
    const summary = src.exposure.length === 0 ? "No Prime ALM proxy labeled for this chain; exposure not computed."
      : total >= 1 ? `Sky exposure ${fmtUsd(total)} across ${src.exposure.filter((e) => e.assets !== "0").length} Prime position${src.exposure.filter((e) => e.assets !== "0").length > 1 ? "s" : ""}. ${ll}`
      : total > 0 ? `No meaningful Sky position (dust, ${fmtUsd(total)}). ${ll}` : `No Sky position. ${ll}`;
    return result("C12", "Sky exposure and Liquidity Layer onboarding", `${ctx.policy.exposure.source} Position = ALM proxy shares converted to assets; onboarding = LIMIT_4626_DEPOSIT rate-limit key for this vault on the Prime's RateLimits contract.`, ctx.policy.exposure.status, summary, [positions], details, citations);
  },
};
