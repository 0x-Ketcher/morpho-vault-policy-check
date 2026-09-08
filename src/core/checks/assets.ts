import type { CheckDef } from "./helpers.ts";
import { pick, result, worst, fmtUnits, fmtUsd, short, ZERO } from "./helpers.ts";
import type { MarketInfo, Status, CheckCell } from "../types.ts";

export const c01Version: CheckDef = {
  id: "C8", title: "Vault version and factory",
  evaluate: (ctx) => {
    const version = pick(ctx, "version", (s) => s.version, (v) => v);
    const factory = pick(ctx, "factory verification", (s) => ({ factory: s.factory ?? null, verified: s.factoryVerified ?? null }), (v) => `${v.verified === true ? "deployed by factory" : v.verified === false ? "NOT deployed by factory" : "not checked"} ${v.factory ?? ""}`.trim(), { tolerance: (a, b) => a.verified === b.verified });
    const name = pick(ctx, "name", (s) => `${s.name ?? "?"} (${s.symbol ?? "?"})`, (v) => v);
    const onchainSaysNo = ctx.a?.factoryVerified === false;
    const status: Status = onchainSaysNo ? "FAIL" : "INFO";
    const summary = onchainSaysNo
      ? "The official factory does not recognise this address as a vault it deployed."
      : `${version.value === "v2" ? "Morpho Vault V2" : "MetaMorpho v1.1"}. ${version.value === "v1.1" ? "v1.1 is not a gap by itself; its Guardian is the sentinel-equivalent seat and V2-only checks are reported as n/a." : "All V2 checks apply."}`;
    return result("C8", "Vault version and factory", "Report only: Vault V2 or MetaMorpho v1.1, confirmed as a factory deployment by the factory contract (on-chain) and by being indexed (API).", status, summary, [version, factory, name]);
  },
};

export const c02Chain: CheckDef = {
  id: "C1", title: "Chain",
  evaluate: (ctx) => {
    const chain = pick(ctx, "chain id", (s) => s.chainId, (v) => String(v));
    const accepted = ctx.policy.chains.accepted.find((c) => c.id === chain.value);
    const status: Status = accepted ? "PASS" : ctx.policy.chains.severityWhenNotAccepted;
    const summary = accepted
      ? `${accepted.name} (${chain.value}) is an accepted chain.`
      : `Chain ${chain.value}${ctx.chainName ? ` (${ctx.chainName})` : ""} is not an accepted chain. The policy requires a risk review and a separate request for any other chain.`;
    return result("C1", "Chain", `Accepted chains: ${ctx.policy.chains.accepted.map((c) => `${c.name} (${c.id})`).join(", ")}. Source: ${ctx.policy.chains.source}`, status, summary, [chain]);
  },
};

export const c03LoanAsset: CheckDef = {
  id: "C2", title: "Loan asset",
  evaluate: (ctx) => {
    const asset = pick(ctx, "asset()", (s) => s.asset.address, (v) => v);
    const symbol = pick(ctx, "asset symbol", (s) => s.asset.symbol ?? "?", (v) => v);
    const list = ctx.policy.loanAssets.accepted[String(ctx.b.chainId)] ?? [];
    const byAddr = list.find((x) => x.address.toLowerCase() === asset.value.toLowerCase());
    const bySymbol = list.find((x) => x.symbol.toLowerCase() === (symbol.value ?? "").toLowerCase());
    let status: Status, summary: string;
    if (byAddr) { status = "PASS"; summary = `${byAddr.symbol} at ${asset.value} is an accepted loan asset on this chain.`; }
    else if (bySymbol) { status = ctx.policy.loanAssets.severityWhenNotAccepted; summary = `Symbol ${symbol.value} matches an accepted asset but the address ${asset.value} is not the allow-listed one (${bySymbol.address}). Treat as not accepted until verified.`; }
    else if (list.length === 0) { status = ctx.policy.loanAssets.severityWhenNotAccepted; summary = `No accepted loan assets are configured for chain ${ctx.b.chainId}; ${symbol.value} at ${asset.value} cannot be accepted.`; }
    else { status = ctx.policy.loanAssets.severityWhenNotAccepted; summary = `${symbol.value} (${asset.value}) is not an accepted loan asset. Accepted on this chain: ${list.map((x) => x.symbol).join(", ")}.`; }
    return result("C2", "Loan asset", `Accepted loan assets: USDC, USDT, PYUSD, RLUSD, USDG (address allow-list per chain in config/policy.json). Source: ${ctx.policy.loanAssets.source}`, status, summary, [asset, symbol], byAddr ? [`Allow-list entry verified via: ${byAddr.verified ?? "n/a"}`] : []);
  },
};

/** allocated = at least one whole unit of the loan asset; anything smaller is dust left after a withdrawal */
const isLive = (m: MarketInfo, decimals?: number) => BigInt(m.allocation ?? m.supplyAssets ?? "0") >= 10n ** BigInt(decimals ?? 0);
const hasCap = (m: MarketInfo) => BigInt(m.cap.absolute ?? m.cap.supplyCap ?? "0") > 0n;

export const c04Collateral: CheckDef = {
  id: "C3", title: "Collateral, LLTV and IRM",
  evaluate: (ctx) => {
    const dec = ctx.b.asset.decimals;
    const key = (m: MarketInfo) => ({ id: m.id, collateral: m.collateralToken, lltv: m.lltv, irm: m.irm, live: isLive(m, dec), capped: hasCap(m) });
    const markets = pick(ctx, "markets (id, collateral, lltv, irm, allocated, capped)", (s) => s.markets.filter((m) => m.collateralToken).map(key).sort((x, y) => x.id.localeCompare(y.id)), (v) => v.map((m) => `${m.id.slice(0, 10)}… ${m.collateral ? m.collateral.slice(0, 8) : "idle"} ${(m.lltv * 100).toFixed(1)}% irm ${m.irm ? m.irm.slice(0, 8) : "none"} ${m.live ? "allocated" : m.capped ? "cap-only" : "empty"}`).join("; "));
    // precise per-market differences for the disagreement box
    const diffs: string[] = [];
    if (markets.discrepancy && markets.a) {
      const A = new Map(markets.a.map((m) => [m.id, m])), B = new Map(markets.b.map((m) => [m.id, m]));
      for (const [id, a] of A) {
        const b = B.get(id);
        if (!b) { diffs.push(`market ${id.slice(0, 10)}… is known on-chain but not by the API`); continue; }
        for (const f of ["collateral", "lltv", "irm", "live", "capped"] as const) {
          const av = String(a[f]), bv = String(b[f]);
          if (av !== bv) diffs.push(`market ${id.slice(0, 10)}… ${f}: on-chain ${av} vs API ${bv}`);
        }
      }
      for (const id of B.keys()) if (!A.has(id)) diffs.push(`market ${id.slice(0, 10)}… is known by the API but not on-chain`);
    }
    const src = ctx.a ?? ctx.b;
    const accepted = ctx.policy.collateral.accepted[String(ctx.b.chainId)] ?? [];
    const acceptedIrms = ctx.policy.irm?.accepted[String(ctx.b.chainId)] ?? [];
    const sev = ctx.policy.collateral.severity, irmSev = ctx.policy.irm?.severity ?? { notAcceptedWithAllocation: "FAIL" as Status, notAcceptedCapOnly: "WARN" as Status };
    const statuses: Status[] = []; const details: string[] = []; const rows: CheckCell[][] = [];
    /** IRM condition for one market: [status or null when not graded, text] */
    const irmVerdict = (m: MarketInfo, live: boolean): [Status | null, string] => {
      if (!m.irm) return [null, "no IRM (not a Morpho Blue v1 market), IRM criterion n/a"];
      const hit = acceptedIrms.find((x) => x.address.toLowerCase() === m.irm!.toLowerCase());
      const disabled = m.irmEnabled === false ? ", but Morpho Blue reports it disabled" : "";
      if (hit) return [m.irmEnabled === false ? (live ? irmSev.notAcceptedWithAllocation : irmSev.notAcceptedCapOnly) : "PASS", `IRM ok${disabled}`];
      if (acceptedIrms.length === 0) return [live ? irmSev.notAcceptedWithAllocation : irmSev.notAcceptedCapOnly, `IRM ${m.irm}: no accepted IRM configured for this chain${disabled}`];
      return [live ? irmSev.notAcceptedWithAllocation : irmSev.notAcceptedCapOnly, `IRM ${m.irm} is NOT the accepted ${acceptedIrms[0].name}${disabled}`];
    };
    for (const m of src.markets) {
      if (!m.collateralToken) { details.push(`${m.id.slice(0, 10)}…: idle market (no collateral), n/a`); continue; }
      const live = isLive(m, dec), capped = hasCap(m);
      if (!live && !capped) { details.push(`${m.collateralSymbol ?? m.collateralToken}: no allocation and no cap, n/a`); continue; }
      const amt = m.supplyAssetsUsd !== undefined ? fmtUsd(m.supplyAssetsUsd) : fmtUnits(m.allocation ?? m.supplyAssets, src.asset.decimals, src.asset.symbol);
      const state = live ? `${amt} allocated` : `cap only, nothing allocated${BigInt(m.allocation ?? m.supplyAssets ?? "0") > 0n ? ", dust remains" : ""}`;
      const byAddr = accepted.find((x) => x.address.toLowerCase() === m.collateralToken!.toLowerCase());
      const bySym = accepted.find((x) => [x.symbol, x.policyName, ...(x.aliases ?? [])].filter(Boolean).some((s) => s!.toLowerCase() === (m.collateralSymbol ?? "").toLowerCase()));
      const lltvPct = `${(m.lltv * 100).toFixed(1)}%`;
      const [irmStatus, irmText] = irmVerdict(m, live);
      const name = m.collateralSymbol ?? short(m.collateralToken!);
      const pair = `${name}/${src.asset.symbol ?? "?"} ${lltvPct}`;
      const maxPct = (x?: number) => `${((x ?? 0) * 100).toFixed(1)}%`;
      // collateral acceptance and LLTV limit are judged separately, then combined with the IRM into the row result
      let accStatus: Status, accText: string, max: number | undefined;
      if (byAddr) { accStatus = "PASS"; accText = "yes"; max = byAddr.maxLltv; }
      else if (bySym) { accStatus = sev.symbolMatchesAddressUnknown; accText = "symbol only"; max = bySym.maxLltv; }
      else { accStatus = live ? sev.notAcceptedWithAllocation : sev.notAcceptedCapOnly; accText = "no"; max = undefined; }
      let lltvStatus: Status | null = null, lltvText = "n/a";
      if (max !== undefined) {
        const ok = m.lltv <= max + 1e-9;
        lltvStatus = ok ? "PASS" : live ? sev.lltvAboveMaxWithAllocation : sev.lltvAboveMaxCapOnly;
        lltvText = ok ? `within ${maxPct(max)}` : `above ${maxPct(max)}`;
      }
      const rowStatus = worst([accStatus, ...(lltvStatus ? [lltvStatus] : []), ...(irmStatus ? [irmStatus] : [])]);
      statuses.push(rowStatus);
      const collateralWords = accText === "yes" ? "accepted collateral" : accText === "symbol only" ? "symbol matches an accepted collateral but the token address is not on the allow-list for this chain, verify on the explorer" : "NOT an accepted collateral";
      const lltvWords = max === undefined ? "" : lltvStatus === "PASS" ? `, LLTV within the ${maxPct(max)} maximum` : `, LLTV above the ${maxPct(max)} maximum`;
      const flag = rowStatus === "PASS" ? "" : live ? ", flag for CRR review" : ", flag for review before any allocation";
      details.push(`${pair}: ${collateralWords}${lltvWords}, ${state}; ${irmText}${flag}`);
      const irmCell = !m.irm ? { text: "n/a", status: "NA" as Status } : irmStatus === "PASS" ? { text: "ok", status: "PASS" as Status } : { text: irmText.replace(/^IRM /, ""), status: irmStatus ?? undefined };
      rows.push([
        { text: name },
        { text: accText, status: accStatus },
        lltvPct,
        { text: lltvText, status: lltvStatus ?? "NA" },
        live ? amt : { text: BigInt(m.allocation ?? m.supplyAssets ?? "0") > 0n ? "cap only, dust" : "cap only", muted: true },
        irmCell,
        { text: rowStatus.toLowerCase(), status: rowStatus },
      ]);
    }
    const status = statuses.length ? worst(statuses) : "NA";
    const summary = statuses.length === 0 ? "No market with an allocation or a cap; nothing to grade (idle vault)."
      : status === "PASS" ? `All ${statuses.length} live or capped markets use accepted collateral within the LLTV maximums and the accepted interest rate model.`
      : `${statuses.filter((s) => s === "FAIL").length} FAIL, ${statuses.filter((s) => s === "WARN").length} WARN across ${statuses.length} live or capped markets.`;
    const table = rows.length ? { columns: ["Collateral", "Accepted", "LLTV", "LLTV limit", "Allocated", "IRM", "Result"], rows } : undefined;
    return result("C3", "Collateral, LLTV and IRM", `Every market with an allocation or a cap must use accepted collateral (ETH/WETH, cbBTC, stETH/wstETH, WBTC at <= 86%; sUSDS at <= 96.5%) and the Morpho Adaptive Curve IRM for its chain. Not accepted with allocation = ${sev.notAcceptedWithAllocation}; cap-only = ${sev.notAcceptedCapOnly}; same severities for a wrong IRM. Sources: ${ctx.policy.collateral.source} ${ctx.policy.irm?.source ?? ""}`, status, summary, [markets], details, [], { table, ...(diffs.length ? { discrepancies: diffs } : {}) });
  },
};

export { ZERO };
