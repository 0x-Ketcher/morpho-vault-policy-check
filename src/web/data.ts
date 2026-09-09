import policyJson from "../../config/policy.json";
import providersJson from "../../config/providers.json";
import skyVaultsJson from "../../config/sky-vaults.json";
import registriesJson from "../../config/registries.json";
import registry from "../../labels/registry.json";
import atlas from "../../labels/atlas.json";
import curators from "../../labels/curators.json";
import safes from "../../labels/safes.json";
import type { PolicyConfig, ProvidersConfig } from "../core/policy.ts";
import { LabelBook, type LabelData } from "../sources/labels/index.ts";

export const policy = policyJson as unknown as PolicyConfig;
export const providers = providersJson as unknown as ProvidersConfig;
export interface SkyVault { address: string; chainId: number; chain: string; version: string; name: string; symbol: string; prime: string; tvlUsd: number; exposureUsd: number; exposureByPrime: Record<string, number>; status: string; relations: string[]; sources: string[]; allocatable: { prime: string }[] }
export const skyVaults = skyVaultsJson as unknown as { generatedAt: string; definition: string; count: number; groups: { prime: string; exposureUsd: number; vaults: SkyVault[] }[] };
export const registries = registriesJson as { registries: { prime: string; repo: string; branch: string }[]; atlas: { repo: string; branch: string } };
export const labelData = { registry, atlas, curators, safes } as unknown as LabelData;
export const labels = new LabelBook(labelData, policy);
