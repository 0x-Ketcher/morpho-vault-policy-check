# Policy table

Generated from `config/policy.json` by `npm run gen:docs`. Do not edit by hand; edit the JSON and regenerate.

Policy: BA Labs - Morpho Vaults v2 Eligibility Criteria
Source: https://docs.google.com/document/d/1cUoOPQaY9BeE_b9W9peEx8fXSesfPyZQ1FlOOacstw8
Snapshot: 2026-09-01; policy last changed: 2026-08-31

- Adapter timelocks were added to the policy on 2026-08-31.
- The increase-timelock minimum was raised from 3 days to 7 days on 2026-08-31.
- An Atlas edit 'Morpho Vault Curation Framework' is expected to become the canonical policy text. When it lands, update this file and cite the article number in every 'source' field.
- The SFF prioritisation cycle of 2026-09-02 proposed adding cbETH and spUSDG to the accepted collateral list. Not applied here until approved.

## Checks

| # | Check | Rule | Severity when violated | Policy source |
|---|---|---|---|---|
| C1 | Vault version and factory | Report only: Vault V2 or MetaMorpho v1.1; factory deployment confirmed | FAIL only if the factory denies the vault | Proposal #11 setup |
| C2 | Chain | Ethereum (1), Base (8453), Robinhood Chain (4663) | FAIL | Policy section 'Accepted chains': Ethereum, Base, Robinhood (higher CRR for non-mainnet chain risk). Others: risk review + separate request. |
| C3 | Loan asset | address allow-list per chain (below) | FAIL | Policy section 'Loan assets': per Atlas cash stablecoins USDC, USDT, pyUSD; also historically approved for Morpho: RLUSD, USDG. Any other loan asset: risk review + separate request. |
| C4 | Collateral, LLTV and IRM | accepted collateral within max LLTV, and the accepted interest rate model, for every market with an allocation or a cap | not accepted with allocation FAIL; cap-only WARN; LLTV above max FAIL/WARN; symbol match but unknown address WARN; wrong IRM FAIL/WARN | Policy section 'Accepted Collateral and Market Parameters' (LLTV = maximum, lower tiers acceptable): ETH 86%, cbBTC 86%, stETH 86%, WBTC 86%, sUSDS 96.5%. Policy table 'Accepted Collateral and Market Parameters', IRM column: 'Morpho Adaptive Curve IRM' on every accepted row. Footnote: the IRM criterion applies to Morpho Blue v1 markets only; Markets V2 (Midnight) set rates through makers and takers and have no IRM. |
| C5 | Owner | Owner = Prime SubProxy (Ethereum) or the Prime's governance executor (Base, Robinhood). An n-of-n Safe that includes the Prime governance address = WARN. Anything else = FAIL. | FAIL / WARN as stated | Policy section 'Morpho Vault v2 Setup - Proposal #11: Prime governance Owner with govops & external party as Curator'. |
| C6 | Curator | Curator = 2/2 Safe between the OEA and the external curator's Safe. Prime- or OEA-only Safe (e.g. a 3/5) = WARN (policy call open: does the 2/2 rule apply to Prime-self-curated vaults). External-only = FAIL. | FAIL / WARN as stated | Policy section 'Morpho Vault v2 Setup - Proposal #11: Prime governance Owner with govops & external party as Curator'. |
| C7 | Sentinel / Guardian | Exactly one sentinel is mandatory: an OEA Safe with a set of signers disjoint from the curator Safe's signers. The curator address, any signer of the curator Safe and any address attributed to the external curator may not hold a sentinel seat. Every additional sentinel must be a Prime-owned multisig or a monitoring solution; an address that no public source attributes is reported as a possible monitoring solution and graded WARN until labeled. No sentinel, or no OEA sentinel = FAIL. OEA-shaped Safe that no public source labels = WARN. On MetaMorpho v1.1 the Guardian is the sentinel-equivalent seat and the same rules apply. | FAIL / WARN as stated | Policy section 'Morpho Vault v2 Setup - Proposal #11: Prime governance Owner with govops & external party as Curator'. |
| C8 | Allocators | Allocator = Prime agent (ALM proxy) / external curator EOA / multisig. Informational. | INFO | Policy section 'Morpho Vault v2 Setup - Proposal #11: Prime governance Owner with govops & external party as Curator'. |
| C9 | Timelocks | per-function minimums (below) | FAIL | Policy section 'Accepted timelocks per function (v2)' and 'Adapter timelocks (added Aug 31)'. Minimums; 'or abdicated' where the policy says '7d/Abdicated'. |
| C10 | Oracles | Policy section 'Collateral pricing / oracle': >= 3 sources (median of 3, average of 2, credible fallback if 1). INTERIM: single-source Chainlink acceptable for major collateral. | INFO | policy section 'Collateral pricing / oracle' |
| C11 | Fees | Policy section 'Fees: TBD'. | INFO | policy section 'Fees' |
| C12 | Sky exposure and Liquidity Layer onboarding | Context, not a policy criterion. After the deadline (about end of September 2026) all non-compliant Morpho allocations receive 100% CRR. | INFO | context |

## Accepted loan assets

| Chain | Symbol | Address | Verified via |
|---|---|---|---|
| Ethereum | USDC | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 | Spark registry Ethereum.sol USDC; Morpho API asset of sparkUSDCbc |
| Ethereum | USDT | 0xdAC17F958D2ee523a2206206994597C13D831ec7 | Spark registry Ethereum.sol USDT; Morpho API asset of sparkUSDTbc |
| Ethereum | PYUSD | 0x6c3ea9036406852006290770BEdFcAbA0e23A0e8 | Spark registry Ethereum.sol PYUSD |
| Ethereum | RLUSD | 0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD | Spark registry Ethereum.sol RLUSD; Morpho API asset of the Sentora x Spark RLUSD vaults |
| Ethereum | USDG | 0xe343167631d89B6Ffc58B88d6b7fB0228795491D | Spark registry Ethereum.sol USDG; Morpho API asset of grove-steakUSDG |
| Robinhood Chain | USDG | 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 | Spark and Grove registries Robinhood.sol USDG; Morpho API asset of groveUSDG |
| Base | USDC | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 | Spark and Grove registries Base.sol USDC; Morpho API asset of the Base vaults |

## Accepted collateral

| Chain | Symbol | Policy name | Max LLTV | Address | Verified via |
|---|---|---|---|---|---|
| Ethereum | WETH | ETH | 86.0% | 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 | Spark registry Ethereum.sol WETH |
| Ethereum | cbBTC | cbBTC | 86.0% | 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf | Spark registry Ethereum.sol CBBTC; Morpho API market data |
| Ethereum | wstETH | stETH | 86.0% | 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0 | Spark registry Ethereum.sol WSTETH; Morpho API market data |
| Ethereum | stETH | stETH | 86.0% | 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84 | well-known Lido stETH address; verify on explorer before relying on it |
| Ethereum | WBTC | WBTC | 86.0% | 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 | Spark registry Ethereum.sol WBTC; Morpho API market data |
| Ethereum | sUSDS | sUSDS | 96.5% | 0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD | Spark registry Ethereum.sol SUSDS; Morpho API market data |
| Base | WETH | ETH | 86.0% | 0x4200000000000000000000000000000000000006 | Spark registry Base.sol WETH; Morpho API market data |
| Base | cbBTC | cbBTC | 86.0% | 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf | Spark registry Base.sol CBBTC; Morpho API market data |
| Base | wstETH | stETH | 86.0% | 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452 | Morpho API market data (steakUSDC Base); cross-check on explorer |
| Base | sUSDS | sUSDS | 96.5% | 0x5875eEE11Cf8398102FdAd704C9E96607675467a | Spark and Grove registries Base.sol SUSDS |

Known non-accepted collateral seen in Sky-related vaults: cbETH, spUSDG, syrupUSDC, weETH, LBTC, AUSD.

## Accepted interest rate model

Policy table 'Accepted Collateral and Market Parameters', IRM column: 'Morpho Adaptive Curve IRM' on every accepted row. Footnote: the IRM criterion applies to Morpho Blue v1 markets only; Markets V2 (Midnight) set rates through makers and takers and have no IRM.

| Chain | Name | Address | Verified via |
|---|---|---|---|
| Ethereum | Morpho Adaptive Curve IRM | 0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC | Spark registry Ethereum.sol MORPHO_DEFAULT_IRM; the only IRM on all 79 collateral markets of the 16 Ethereum vaults checked on 2026-09-08; Morpho Blue isIrmEnabled = true |
| Robinhood Chain | Morpho Adaptive Curve IRM | 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1 | No registry publishes it for Robinhood. Morpho API irmAddress of every groveUSDG market; Morpho Blue on Robinhood (0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010, per the adapter's morpho() and the API) reports isIrmEnabled = true. Bytecode differs in size from the Ethereum deployment, so a bytecode comparison is inconclusive; a registry entry or Morpho's deployment list should confirm this is the Adaptive Curve IRM. |
| Base | Morpho Adaptive Curve IRM | 0x46415998764C29aB2a25CbeA6254146D50D22687 | Spark registry Base.sol MORPHO_DEFAULT_IRM; the only IRM on all 16 collateral markets of the 5 Base vaults checked on 2026-09-08; Morpho Blue isIrmEnabled = true |

## Timelock minimums (Vault V2)

| Scope | Function | Policy label | Minimum | Abdication satisfies | Note |
|---|---|---|---|---|---|
| vault | `abdicate(bytes4)` | Abdicate | 7d | no |  |
| vault | `addAdapter(address)` | Add adapter | 7d | no |  |
| vault | `removeAdapter(address)` | Remove adapter | 7d | no |  |
| vault | `increaseAbsoluteCap(bytes,uint256)` | Increase absolute cap | 7d | no |  |
| vault | `increaseRelativeCap(bytes,uint256)` | Increase relative cap | 7d | no |  |
| vault | `setIsAllocator(address,bool)` | Add/Remove allocator | 3d | no |  |
| vault | `increaseTimelock(bytes4,uint256)` | Increase timelock duration | 7d | no |  |
| vault | `setPerformanceFee(uint256)` | Set performance fee | 3d | no |  |
| vault | `setManagementFee(uint256)` | Set management fee | 3d | no |  |
| vault | `setPerformanceFeeRecipient(address)` | Set performance fee recipient | 3d | no |  |
| vault | `setManagementFeeRecipient(address)` | Set management fee recipient | 3d | no |  |
| vault | `setForceDeallocatePenalty(address,uint256)` | Set force deallocate penalty | 7d | no |  |
| vault | `setReceiveSharesGate(address)` | Set receive shares gate | 7d | yes |  |
| vault | `setSendSharesGate(address)` | Set send shares gate | 7d | yes |  |
| vault | `setReceiveAssetsGate(address)` | Set receive assets gate | 7d | yes |  |
| vault | `setSendAssetsGate(address)` | Set send assets gate | 7d | yes | The policy snapshot lists 7d without '/Abdicated' for this gate; treated like the other gates, to confirm with BA. |
| vault | `setAdapterRegistry(address)` | Set adapter registry | 7d | yes |  |
| adapter | `abdicate(bytes4)` | Adapter: Abdicate | 7d | no |  |
| adapter | `burnShares(bytes32)` | Adapter: Burn shares | 3d | no |  |
| adapter | `increaseTimelock(bytes4,uint256)` | Adapter: Increase timelock | 7d | no |  |
| adapter | `setSkimRecipient(address)` | Adapter: Skim recipient | 3d | no |  |
| vault | `setMaxRate(uint256)` | Set max rate (no policy minimum) | none | - | informational |

Owner functions (setOwner, setCurator, setIsSentinel, setName, setSymbol) and every 'decrease' function are immediate by Vault V2 design and have no timelock to check.

## OEA identity

No public source labels an OEA Safe address on 2026-09-04. The Atlas Ozone OEA article (A.6.1.2.2) is the recommended place to publish them so this check can turn PASS from a public source.

OEA entity names recognised in Atlas text: Soter Labs, Soter, Operational Executor Agent, Ozone.

Primes: Grove, Spark, Osero, Skybase, Keel. Morpho curator registry names treated as Prime-side: SparkDAO -> Spark, Sky Money -> Skybase, Grove -> Grove.

