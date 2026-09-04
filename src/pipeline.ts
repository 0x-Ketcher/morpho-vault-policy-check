import { getAddress, isAddress } from "viem";
import type { Address, Report } from "./core/types.ts";
import type { PolicyConfig, ProvidersConfig } from "./core/policy.ts";
import { LabelBook } from "./sources/labels/index.ts";
import { MorphoApi, type FoundVault } from "./sources/morpho-api/client.ts";
import { buildApiSnapshot } from "./sources/morpho-api/snapshot.ts";
import { OnchainReader, httpEndpoint, type Endpoint } from "./sources/onchain/client.ts";
import { readVaultOnchain, detectVersionOnchain } from "./sources/onchain/vault.ts";
import { etherscanTransport } from "./sources/etherscan/transport.ts";
import { buildReport } from "./core/report.ts";
import type { CheckContext } from "./core/checks/index.ts";

export interface Deps {
  policy: PolicyConfig;
  providers: ProvidersConfig;
  labels: LabelBook;
  api: MorphoApi;
  /** Etherscan as a failover provider: base URL (API or server proxy), optional key (Node only), chains it covers */
  etherscan?: { base: string; apiKey?: string; chains: number[] };
  log?: (m: string) => void;
}

export const ETHERSCAN_MORPHO_CHAINS = [1, 8453, 10, 130, 137, 143, 480, 988, 999, 42161, 747474];

export function makeReader(deps: Deps, chainId: number): OnchainReader | null {
  const cfg = deps.providers.chains[String(chainId)];
  const endpoints: Endpoint[] = (cfg?.rpc ?? []).map(httpEndpoint);
  if (deps.etherscan && deps.etherscan.chains.includes(chainId)) endpoints.push({ label: `etherscan${deps.etherscan.apiKey ? "" : " (via server proxy)"}`, transport: etherscanTransport({ chainId, base: deps.etherscan.base, apiKey: deps.etherscan.apiKey }) });
  if (endpoints.length === 0) return null;
  return new OnchainReader(chainId, cfg?.name ?? `chain ${chainId}`, endpoints, deps.providers.multicall3, { pinLag: cfg?.pinLag });
}

export async function findCandidates(deps: Deps, address: string): Promise<FoundVault[]> {
  if (!isAddress(address)) throw new Error(`not an EVM address: ${address}`);
  return deps.api.findVault(getAddress(address));
}

export async function checkVault(deps: Deps, address: string, chainId?: number): Promise<Report> {
  const log = deps.log ?? (() => {});
  if (!isAddress(address)) throw new Error(`not an EVM address: ${address}`);
  const vault = getAddress(address) as Address;

  log("Looking the address up on every chain the Morpho API indexes...");
  let found = await deps.api.findVault(vault);
  if (chainId !== undefined) found = found.filter((f) => f.chainId === chainId);
  if (found.length === 0) {
    if (chainId === undefined) throw new Error(`The Morpho API does not know a vault at ${vault} on any of the ${deps.providers.morphoChains.ids.length} chains it indexes. If it is on another chain, pass the chain id explicitly.`);
    // API does not know it: try to identify it from chain state alone
    const reader = makeReader(deps, chainId);
    if (!reader) throw new Error(`The Morpho API does not know ${vault} on chain ${chainId}, and no on-chain provider is configured for that chain.`);
    const version = await detectVersionOnchain(reader, vault);
    if (!version) throw new Error(`The Morpho API does not know ${vault} on chain ${chainId}, and chain state shows neither a Vault V2 nor a MetaMorpho v1.1 there.`);
    throw new Error(`${vault} on chain ${chainId} looks like a ${version} vault on-chain but the Morpho API does not index it, so the second method is unavailable. Not evaluated.`);
  }
  if (found.length > 1) throw new Error(`${vault} is a Morpho vault on several chains: ${found.map((f) => `${f.network} (${f.chainId}, ${f.version})`).join(", ")}. Pass the chain id.`);
  const f = found[0];
  const chainName = deps.providers.chains[String(f.chainId)]?.name ?? f.network;
  log(`Found ${f.name ?? vault} on ${f.network} (${f.chainId}), ${f.version}. Reading the Morpho API and the Safe service...`);

  const b = await buildApiSnapshot(deps.api, deps.providers.safeTxService[String(f.chainId)], vault, f.chainId, f.version, deps.labels, deps.policy.timelocks);

  const reader = makeReader(deps, f.chainId);
  let a = null, providerReport;
  if (reader) {
    log(`Reading chain state via ${reader.urls[0]}${reader.urls[1] ? ` and ${reader.urls[1]}` : ""}...`);
    try {
      const cid = await reader.chainIdOfPrimary();
      if (cid !== f.chainId) throw new Error(`provider answers for chain ${cid}, expected ${f.chainId}`);
      a = await readVaultOnchain(reader, vault, { version: f.version, factory: b.factory, sentinels: b.sentinels, allocators: b.allocators, markets: b.markets.map((m) => ({ adapter: m.adapter, id: m.id })), assetPriceUsd: b.totalAssetsUsd && b.totalAssets && Number(b.totalAssets) > 0 && b.asset.decimals !== undefined ? b.totalAssetsUsd / (Number(b.totalAssets) / 10 ** b.asset.decimals) : undefined }, deps.labels, deps.policy.timelocks);
      await reader.finish();
      providerReport = reader.report();
    } catch (e) {
      log(`On-chain read failed: ${(e as Error).message}`);
      providerReport = { ...reader.report(), secondaryStatus: "unavailable" as const, disagreements: [`on-chain read failed: ${(e as Error).message}`] };
    }
  } else {
    providerReport = { chainId: f.chainId, block: 0, primary: "none", secondary: null, secondaryStatus: "not-configured" as const, disagreements: ["no on-chain provider configured for this chain: every value is API-only"], calls: 0 };
  }
  const ctx: CheckContext = { policy: deps.policy, labels: deps.labels, a, b, chainName };
  log("Evaluating the checks...");
  return buildReport(ctx, providerReport, deps.labels.meta());
}
