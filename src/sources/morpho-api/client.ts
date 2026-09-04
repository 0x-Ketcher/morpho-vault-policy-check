import type { Address, Hex } from "../../core/types.ts";

export class MorphoApiError extends Error {}

export interface FoundVault {
  address: Address;
  chainId: number;
  network: string;
  version: "v2" | "v1.1";
  name?: string;
  symbol?: string;
}

const V2_FIELDS = `
  address name symbol listed type
  chain { id network }
  asset { address symbol decimals price { usd timestamp } }
  factory { address }
  owner { address } curator { address }
  curators { items { id name verified addresses { chainId address } } }
  sentinels { sentinel { address } blockNumber timestamp }
  allocators { allocator { address } blockNumber timestamp }
  timelocks { selector functionName duration blockNumber timestamp abdicatedAt }
  adapters { items { address type assets assetsUsd forceDeallocatePenalty } }
  liquidityAdapter { address }
  caps { items { id idData type absoluteCap relativeCap allocation
    data { __typename
      ... on MarketV1CapData { adapterAddress
        marketParams { id loanToken collateralToken oracle irm lltv }
        market { marketId lltv irmAddress
          collateralAsset { address symbol decimals } loanAsset { address symbol decimals }
          oracle { address type } morphoBlue { address }
          state { supplyAssets supplyAssetsUsd supplyShares } } }
      ... on AdapterCapData { adapter { address } }
    } } }
  performanceFee managementFee performanceFeeRecipient managementFeeRecipient
  performanceFeeConfig { value abdicated } managementFeeConfig { value abdicated }
  gatesConfig {
    sendSharesGate { address abdicated } receiveSharesGate { address abdicated }
    sendAssetsGate { address abdicated } receiveAssetsGate { address abdicated } }
  totalAssets totalAssetsUsd idleAssets idleAssetsUsd sharePrice maxRate
`;

const V1_FIELDS = `
  address name symbol listed
  chain { id network }
  asset { address symbol decimals price { usd timestamp } }
  factory { address }
  allocators { address blockNumber }
  state { blockNumber timestamp owner curator guardian timelock fee feeRecipient skimRecipient pendingOwner
    totalAssets totalAssetsUsd sharePriceUsd
    curators { id name verified addresses { chainId address } }
    allocation { supplyAssets supplyAssetsUsd supplyShares supplyCap supplyCapUsd supplyQueueIndex withdrawQueueIndex removableAt
      market { marketId lltv irmAddress
        collateralAsset { address symbol decimals } loanAsset { address symbol decimals }
        oracle { address type } morphoBlue { address }
        state { supplyAssets supplyShares } } } }
`;

export class MorphoApi {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly url: string, fetchImpl?: typeof fetch) {
    // bind explicitly: calling window.fetch as a method of this object throws "Illegal invocation" in browsers
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new MorphoApiError(body.errors.map((e) => e.message).join("; ").slice(0, 300));
    if (!res.ok || !body.data) throw new MorphoApiError(`HTTP ${res.status}`);
    return body.data;
  }

  /** Chain-agnostic lookup: returns every chain on which the address is a Morpho vault (V2 or v1.1). */
  async findVault(address: Address): Promise<FoundVault[]> {
    const q = `query($a: [String!]) {
      vaultV2s(where: { address_in: $a }) { items { address name symbol chain { id network } } }
      vaults(where: { address_in: $a }) { items { address name symbol chain { id network } } }
    }`;
    type R = { vaultV2s: { items: { address: string; name: string; symbol: string; chain: { id: number; network: string } }[] }; vaults: { items: { address: string; name: string; symbol: string; chain: { id: number; network: string } }[] } };
    const d = await this.gql<R>(q, { a: [address] });
    const out: FoundVault[] = [];
    for (const v of d.vaultV2s.items) out.push({ address: v.address as Address, chainId: v.chain.id, network: v.chain.network, version: "v2", name: v.name, symbol: v.symbol });
    for (const v of d.vaults.items) out.push({ address: v.address as Address, chainId: v.chain.id, network: v.chain.network, version: "v1.1", name: v.name, symbol: v.symbol });
    return out;
  }

  async chains(): Promise<{ id: number; network: string }[]> {
    const d = await this.gql<{ chains: { id: number; network: string }[] }>(`{ chains { id network } }`);
    return d.chains;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async vaultV2(address: Address, chainId: number): Promise<any> {
    const d = await this.gql<{ vaultV2ByAddress: unknown }>(`query($a: String!, $c: Int!) { vaultV2ByAddress(address: $a, chainId: $c) { ${V2_FIELDS} } }`, { a: address, c: chainId });
    return d.vaultV2ByAddress;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async vaultV1(address: Address, chainId: number): Promise<any> {
    const d = await this.gql<{ vaultByAddress: unknown }>(`query($a: String!, $c: Int!) { vaultByAddress(address: $a, chainId: $c) { ${V1_FIELDS} } }`, { a: address, c: chainId });
    return d.vaultByAddress;
  }

  /** Position of a user in a vault, in vault-asset units and USD. Returns null when the API has no position. */
  async position(user: Address, vault: Address, chainId: number, version: "v2" | "v1.1"): Promise<{ shares: string; assets: string; assetsUsd: number } | null> {
    try {
      if (version === "v2") {
        const d = await this.gql<{ vaultV2PositionByAddress: { shares: string; assets: string; assetsUsd: number } | null }>(
          `query($u: String!, $v: String!, $c: Int!) { vaultV2PositionByAddress(userAddress: $u, vaultAddress: $v, chainId: $c) { shares assets assetsUsd } }`,
          { u: user, v: vault, c: chainId },
        );
        return d.vaultV2PositionByAddress;
      }
      const d = await this.gql<{ vaultPosition: { state: { shares: string; assets: string; assetsUsd: number } | null } | null }>(
        `query($u: String!, $v: String!, $c: Int!) { vaultPosition(userAddress: $u, vaultAddress: $v, chainId: $c) { state { shares assets assetsUsd } } }`,
        { u: user, v: vault, c: chainId },
      );
      return d.vaultPosition?.state ?? null;
    } catch (e) {
      if (e instanceof MorphoApiError && /not found|no position|does not exist|no results/i.test(e.message)) return null;
      throw e;
    }
  }

  /** Morpho's public curator registry: curator name -> addresses per chain. */
  async curators(): Promise<{ id: string; name: string; verified: boolean; addresses: { chainId: number; address: string }[] }[]> {
    const d = await this.gql<{ curators: { items: { id: string; name: string; verified: boolean; addresses: { chainId: number; address: string }[] }[] } }>(
      `{ curators(first: 500) { items { id name verified addresses { chainId address } } } }`,
    );
    return d.curators.items;
  }
}

export type { Hex };
