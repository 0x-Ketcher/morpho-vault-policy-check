import type { CheckDef } from "./helpers.ts";
import { pick, result, worst, fmtUnits, fmtUsd, short, ZERO } from "./helpers.ts";
import type { MarketInfo, Status } from "../types.ts";

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
    const markets = pick(ctx, "markets (id, collateral, lltv, irm, allocated, capped)", (s) => s.markets.map(key).sort((x, y) => x.id.localeCompare(y.id)), (v) => v.map((m) => `${m.id.slice(0, 10)}… ${m.collateral ? m.collateral.slice(0, 8) : "idle"} ${(m.lltv * 100).toFixed(1)}% irm ${m.irm ? m.irm.slice(0, 8) : "none"} ${m.live ? "allocated" : m.capped ? "cap-only" : "empty"}`).join("; "));
    const src = ctx.a ?? ctx.b;
    const accepted = ctx.policy.collateral.accepted[String(ctx.b.chainId)] ?? [];
    const acceptedIrms = ctx.policy.irm?.accepted[String(ctx.b.chainId)] ?? [];
    const sev = ctx.policy.collateral.severity, irmSev = ctx.policy.irm?.severity ?? { notAcceptedWithAllocation: "FAIL" as Status, notAcceptedCapOnly: "WARN" as Status };
    const statuses: Status[] = []; const details: string[] = [];
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
      let collStatus: Status, line: string;
      const pair = `${m.collateralSymbol ?? short(m.collateralToken!)}/${src.asset.symbol ?? "?"} ${lltvPct}`;
      if (byAddr) {
        if (m.lltv <= (byAddr.maxLltv ?? 0) + 1e-9) { collStatus = "PASS"; line = `${pair}: accepted (max ${((byAddr.maxLltv ?? 0) * 100).toFixed(1)}%), ${state}`; }
        else { collStatus = live ? sev.lltvAboveMaxWithAllocation : sev.lltvAboveMaxCapOnly; line = `${pair}: LLTV above the ${((byAddr.maxLltv ?? 0) * 100).toFixed(1)}% maximum, ${state}`; }
      } else if (bySym) { collStatus = sev.symbolMatchesAddressUnknown; line = `${pair}: symbol matches accepted ${bySym.policyName ?? bySym.symbol} but the token address is not on the allow-list for this chain, verify on the explorer; ${state}`; }
      else { collStatus = live ? sev.notAcceptedWithAllocation : sev.notAcceptedCapOnly; line = `${pair}: NOT an accepted collateral, ${state}, ${live ? "flag for CRR review" : "flag for review before any allocation"}`; }
      statuses.push(worst([collStatus, ...(irmStatus ? [irmStatus] : [])]));
      details.push(`${line}; ${irmText}${irmStatus && irmStatus !== "PASS" ? ", flag for review" : ""}`);
    }
    const status = statuses.length ? worst(statuses) : "NA";
    const summary = statuses.length === 0 ? "No market with an allocation or a cap; nothing to grade (idle vault)."
      : status === "PASS" ? `All ${statuses.length} live or capped markets use accepted collateral within the LLTV maximums and the accepted interest rate model.`
      : `${statuses.filter((s) => s === "FAIL").length} FAIL, ${statuses.filter((s) => s === "WARN").length} WARN across ${statuses.length} live or capped markets.`;
    return result("C3", "Collateral, LLTV and IRM", `Every market with an allocation or a cap must use accepted collateral (ETH/WETH, cbBTC, stETH/wstETH, WBTC at <= 86%; sUSDS at <= 96.5%) and the Morpho Adaptive Curve IRM for its chain. Not accepted with allocation = ${sev.notAcceptedWithAllocation}; cap-only = ${sev.notAcceptedCapOnly}; same severities for a wrong IRM. Sources: ${ctx.policy.collateral.source} ${ctx.policy.irm?.source ?? ""}`, status, summary, [markets], details);
  },
};

export { ZERO };
