import type { Status } from "./types.ts";

export interface AcceptedAsset { symbol: string; address: string; policyName?: string; maxLltv?: number; verified?: string; aliases?: string[] }
export interface TimelockFn { function: string; label: string; minDays?: number; abdicationSatisfies?: boolean; note?: string }

export interface PolicyConfig {
  meta: { policy: string; policyUrl: string; snapshotDate: string; policyLastChanged: string; notes: string[] };
  chains: { source: string; accepted: { id: number; name: string }[]; severityWhenNotAccepted: Status };
  loanAssets: { source: string; severityWhenNotAccepted: Status; accepted: Record<string, AcceptedAsset[]> };
  collateral: {
    source: string;
    severity: { notAcceptedWithAllocation: Status; notAcceptedCapOnly: Status; lltvAboveMaxWithAllocation: Status; lltvAboveMaxCapOnly: Status; symbolMatchesAddressUnknown: Status };
    accepted: Record<string, AcceptedAsset[]>;
    knownNotAccepted: string[];
  };
  irm: { source: string; severity: { notAcceptedWithAllocation: Status; notAcceptedCapOnly: Status }; accepted: Record<string, { name: string; address: string; verified?: string }[]> };
  roles: { source: string; owner: string; curator: string; sentinel: string; allocator: string };
  timelocks: { source: string; severityBelowMinimum: Status; vault: TimelockFn[]; adapter: TimelockFn[]; informational: TimelockFn[]; note: string };
  oracle: { source: string; status: Status };
  fees: { source: string; status: Status };
  exposure: { source: string; status: Status };
  oea: { entities: string[]; note: string };
  primes: { names: string[]; curatorRegistryAliases: Record<string, string> };
}

export interface ProvidersConfig {
  morphoApi: string;
  multicall3: `0x${string}`;
  safeConfigService: string;
  safeTxService: Record<string, string>;
  etherscan: { api: string; chainlist: string; note: string };
  chains: Record<string, { name: string; rpc: (string | { url: string; batch?: boolean })[]; explorer: string; blockscout: string | null; verified: string | null; pinLag?: number }>;
  morphoChains: { note: string; ids: number[] };
}
