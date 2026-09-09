import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { PolicyConfig, ProvidersConfig } from "../core/policy.ts";
import { LabelBook, type LabelData } from "../sources/labels/index.ts";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const p = (...rel: string[]) => join(repoRoot, ...rel);

export function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(p(rel), "utf8")) as T;
}
export const loadPolicy = () => loadJson<PolicyConfig>("config/policy.json");
export const loadProviders = () => loadJson<ProvidersConfig>("config/providers.json");
export interface SkyVaultsFile { generatedAt: string; definition: string; count: number; groups: { prime: string; exposureUsd: number; vaults: { address: string; chainId: number; chain: string; version: string; name: string; symbol: string; prime: string; tvlUsd: number; exposureUsd: number; status: string; relations: string[]; sources: string[]; decimals?: number; allocatable: { prime: string; maxAmount: string; perDay: string }[] }[] }[] }
export const loadSkyVaults = () => loadJson<SkyVaultsFile>("config/sky-vaults.json");

export function loadLabelData(): LabelData {
  const opt = <T>(rel: string): T | undefined => (existsSync(p(rel)) ? loadJson<T>(rel) : undefined);
  return { registry: opt("labels/registry.json"), atlas: opt("labels/atlas.json"), curators: opt("labels/curators.json"), safes: opt("labels/safes.json"), local: opt("config/local-labels.json") };
}
export const loadLabels = (policy: PolicyConfig) => new LabelBook(loadLabelData(), policy);

/** Minimal .env loader: KEY=value lines, no expansion; never overrides an existing variable. */
export function loadEnv(): void {
  const f = p(".env");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
