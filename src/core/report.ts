import type { Report, ProviderReport, VaultSnapshot, Status } from "./types.ts";
import { CHECKS, type CheckContext } from "./checks/index.ts";
import { worst } from "./checks/helpers.ts";

export function buildReport(ctx: CheckContext, providers: ProviderReport, labelsMeta: Record<string, unknown>): Report {
  const checks = CHECKS.map((c) => {
    try { return c.evaluate(ctx); }
    catch (e) {
      return { id: c.id, title: c.title, requirement: "", status: "NA" as Status, discrepancy: false, discrepancies: [], singleSource: false, summary: `Check could not be evaluated: ${(e as Error).message}`, details: [], evidence: [], citations: [] };
    }
  });
  const graded = checks.map((c) => c.status).filter((s) => s === "PASS" || s === "WARN" || s === "FAIL");
  const b = ctx.b;
  return {
    generatedAt: new Date().toISOString(),
    vault: { address: b.address, chainId: b.chainId, chainName: ctx.chainName, version: b.version, name: b.name, symbol: b.symbol, asset: b.asset.symbol, totalAssetsUsd: b.totalAssetsUsd },
    worst: worst(graded),
    checks, providers, labelsMeta, snapshotA: ctx.a, snapshotB: ctx.b,
  };
}

export type { VaultSnapshot };
