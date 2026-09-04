import policyJson from "../../config/policy.json";
import providersJson from "../../config/providers.json";
import knownVaultsJson from "../../config/known-vaults.json";
import registriesJson from "../../config/registries.json";
import registry from "../../labels/registry.json";
import atlas from "../../labels/atlas.json";
import curators from "../../labels/curators.json";
import safes from "../../labels/safes.json";
import type { PolicyConfig, ProvidersConfig } from "../core/policy.ts";
import { LabelBook, type LabelData } from "../sources/labels/index.ts";

export const policy = policyJson as unknown as PolicyConfig;
export const providers = providersJson as unknown as ProvidersConfig;
export const knownVaults = knownVaultsJson as { vaults: { name: string; chainId: number; address: string; prime?: string }[] };
export const registries = registriesJson as { registries: { prime: string; repo: string; branch: string }[]; atlas: { repo: string; branch: string } };
export const labelData = { registry, atlas, curators, safes } as unknown as LabelData;
export const labels = new LabelBook(labelData, policy);
