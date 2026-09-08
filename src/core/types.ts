/** Shared data model. Both read methods (on-chain and Morpho API) are normalised into the same VaultSnapshot shape
 *  so that the checks can be evaluated identically on each and the two results compared field by field. */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type VaultVersion = "v2" | "v1.1";
export type Status = "PASS" | "WARN" | "FAIL" | "NA" | "INFO";
export type Method = "onchain" | "api" | "safe-service" | "labels";

export interface SafeInfo {
  address: Address;
  isContract: boolean;
  isSafe: boolean;
  version?: string;
  threshold?: number;
  owners?: Address[];
  /** One level of nesting: owners that are Safes themselves. */
  ownerSafes?: Record<string, SafeInfo>;
  /** true when this method could not read the structure at all (service down); not the same as "not a Safe" */
  unavailable?: boolean;
  source: Method;
}

export interface MarketInfo {
  id: Hex;
  loanToken: Address;
  collateralToken: Address | null; // null = idle market (no collateral)
  oracle: Address | null;
  irm: Address | null;
  lltv: number; // fraction, 0.86 = 86 %
  collateralSymbol?: string;
  loanSymbol?: string;
  /** Vault (or adapter) supply in this market, raw units of the loan asset. */
  supplyAssets: string;
  supplyAssetsUsd?: number;
  cap: { absolute?: string; relative?: string; supplyCap?: string; supplyCapUsd?: number; enabled?: boolean };
  /** V2 vault-level allocation for this market id, raw units. */
  allocation?: string;
  adapter?: Address;
  oracleType?: string;
  /** Morpho Blue isIrmEnabled(irm); on-chain only */
  irmEnabled?: boolean;
  morphoBlue?: Address;
}

export interface AdapterInfo {
  address: Address;
  type?: string;
  markets: Hex[];
  /** keyed by function signature, seconds */
  timelocks?: Record<string, number>;
  abdicated?: Record<string, boolean>;
  skimRecipient?: Address;
  parentVault?: Address;
  morpho?: Address;
  assetsUsd?: number;
  forceDeallocatePenalty?: string;
}

export interface TimelockInfo {
  selector: Hex;
  seconds: number;
  abdicated: boolean;
}

export interface RateLimitData {
  maxAmount: string;
  slope: string;
  lastAmount: string;
  lastUpdated: number;
}

export interface ExposureInfo {
  prime: string;
  almProxy: Address;
  almProxyLabel: string;
  shares: string;
  assets: string;
  assetsUsd?: number;
  rateLimits?: {
    contract: Address;
    label: string;
    depositKey: Hex;
    deposit: RateLimitData | null;
    withdrawKey: Hex;
    withdraw: RateLimitData | null;
    onboarded: boolean;
  };
}

export interface VaultSnapshot {
  source: Method;
  address: Address;
  chainId: number;
  version: VaultVersion;
  name?: string;
  symbol?: string;
  factory?: Address;
  /** true = the factory confirms it deployed this vault; null = not checked by this method */
  factoryVerified?: boolean | null;
  asset: { address: Address; symbol?: string; decimals?: number };
  owner: Address;
  curator: Address;
  guardian?: Address | null;
  sentinels: Address[];
  allocators: Address[];
  adapters: AdapterInfo[];
  markets: MarketInfo[];
  /** V2: keyed by function signature */
  timelocks: Record<string, TimelockInfo>;
  /** v1.1: the single vault timelock, seconds */
  timelockV1?: number;
  fees: {
    performanceFee?: number;
    managementFee?: number;
    performanceFeeRecipient?: Address;
    managementFeeRecipient?: Address;
    feeV1?: number;
    feeRecipientV1?: Address;
    skimRecipient?: Address;
  };
  gates?: Record<string, { address: Address; abdicated?: boolean }>;
  adapterRegistry?: Address;
  adapterRegistryAbdicated?: boolean;
  totalAssets?: string;
  totalAssetsUsd?: number;
  idleAssetsUsd?: number;
  exposure: ExposureInfo[];
  safes: Record<string, SafeInfo>;
  meta: {
    block?: number;
    blockTimestamp?: number;
    fetchedAt: string;
    providers?: string[];
    notes: string[];
  };
}

export type LabelSource = "registry" | "atlas" | "morpho-curators" | "safe-owners" | "local";

export interface Citation {
  source: LabelSource;
  entity?: string;
  role?: string;
  /** human-readable reference: file + constant, article + line, curator name, ... */
  ref: string;
  commit?: string;
  url?: string;
  nonPublic?: boolean;
}

export interface Evidence {
  method: Method;
  label: string;
  value: string;
  block?: number;
  source?: string;
}

export interface CheckResult {
  id: string;
  title: string;
  requirement: string;
  status: Status;
  /** true when the two methods disagree on a value this check depends on */
  discrepancy: boolean;
  discrepancies: string[];
  /** true when only one method could produce the value (the other has no equivalent read) */
  singleSource: boolean;
  summary: string;
  details: string[];
  evidence: Evidence[];
  citations: Citation[];
}

export interface ProviderReport {
  chainId: number;
  block: number;
  blockTimestamp?: number;
  primary: string;
  secondary: string | null;
  secondaryStatus: "agree" | "disagree" | "unavailable" | "not-configured";
  disagreements: string[];
  calls: number;
}

export interface Report {
  generatedAt: string;
  vault: {
    address: Address;
    chainId: number;
    chainName: string;
    version: VaultVersion;
    name?: string;
    symbol?: string;
    asset?: string;
    totalAssetsUsd?: number;
  };
  worst: Status;
  checks: CheckResult[];
  providers: ProviderReport;
  labelsMeta: Record<string, unknown>;
  snapshotA: VaultSnapshot | null;
  snapshotB: VaultSnapshot;
}
