# Data sources

All public. No internal wallet trackers, no Notion, no private registries. Verified on 2026-09-04 unless stated.

## Chain state (method A)

| Chain | Providers, in order | Notes |
|---|---|---|
| Ethereum (1) | publicnode, Merkle, 1RPC | all answer browser requests, JSON-RPC batches of 10 and `eth_call` at a pinned block; Cloudflare's endpoint returned internal errors and was dropped |
| Base (8453) | publicnode, the official Base node | same |
| Robinhood Chain (4663) | publicnode, the official Robinhood node | the official node lags a few blocks, so reads are pinned 20 blocks back; Etherscan does not cover this chain; the Blockscout explorer sits behind a bot challenge and is unusable as an API |
| other Morpho chains | one publicnode endpoint where known, otherwise none | a vault on a chain without a provider is identified via the API and fails the chain check; every card shows "single source" |

How reads work: every read in a run is pinned to one block (latest minus a per-chain margin), folded into Multicall3 `aggregate3` calls, and replayed on the second provider at the same block. The report states which provider served, the block, the timestamp, the read count and any provider disagreement. If the first provider fails mid-run the reader fails over to the next one at the same block.

Etherscan (API v2, one key for 61 chains) is wired in as a third, failover provider behind the same reader, through a transport that maps JSON-RPC calls onto Etherscan's proxy module. It needs a key. The CLI and CI take it from the environment; the deployed page reaches it through the server's `/api/etherscan` route, which holds the key, forwards only `eth_call`, `eth_getCode`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_chainId`, `getabi` and `getsourcecode`, accepts same-origin requests only and rate-limits per client. The page itself never contains a key. A visitor can also paste their own key in the settings; it stays in their browser.

Multicall3 is deployed at `0xcA11bde05977b3631167028862bE2a173976CA11` on all three accepted chains (verified).

## Morpho API (method B)

`https://blue-api.morpho.org/graphql`, keyless, accepts browser requests. Field names were verified by introspection on 2026-09-04; the API returns HTTP 400 with the list of unknown fields, so introspect rather than guess. Used queries: `vaultV2s(where: { address_in })` and `vaults(where: { address_in })` for the chain-agnostic lookup across the 14 chains the API indexes; `vaultV2ByAddress` and `vaultByAddress` for the full state; `vaultV2PositionByAddress` and `vaultPosition` for ALM proxy positions; `curators` for the public curator registry. `Market` uses `marketId`, not `uniqueKey`.

## Safe Transaction Service

`https://api.safe.global/tx-service/<eth|base|robinhood>` (the older per-chain hostnames redirect there). Keyless. Gives owners, threshold and version and is the second source for Safe structure next to on-chain `getOwners()` / `getThreshold()` / `VERSION()`. The config service lists 54 chains, Robinhood included.

## Labels

| Source | What it labels | How it is read |
|---|---|---|
| Prime address registries: `grove-labs/grove-address-registry`, `sparkdotfi/spark-address-registry`, `osero-io/osero-address-registry`, `skybase-foundation/skybase-address-registry`, `ElodinLTD/keel-address-registry` | SubProxies, executors, ALM proxies, rate-limit contracts, Morpho curator/guardian multisigs, Morpho vault addresses, tokens; one Solidity file per chain | `address internal constant NAME = 0x…;` lines parsed by `scripts/sync-labels.ts` at the branch head commit; every entry keeps file, line, constant and commit |
| The Atlas: `sky-ecosystem/next-gen-atlas`, `content/` folder (18 Markdown files, 3.8 MB) | Spark's Morpho instance role addresses (curator, guardian, allocator), Grove instance token addresses and rate-limit ids, governance accounts | every 20-byte address (a strict pattern that rejects 32-byte ids) is recorded with the nearest numbered heading, its UUID, the line text, a role hint from keywords and an entity hint from patterns like "Curator: <Entity>," |
| Morpho curator registry (API `curators`) | curator name to addresses per chain: Steakhouse Financial, Sentora, SparkDAO, Sky Money, and others | `scripts/sync-labels.ts`; names that are Primes are mapped through `policy.primes.curatorRegistryAliases` |
| Safe owners table (`labels/safes.json`) | owners, threshold and version of every Safe the tool knows about, read on-chain and cross-checked with the Safe service | `scripts/read-safes.ts`; used for the signer-overlap attribution and rendered as `docs/SAFES.md` |
| `config/local-labels.json` (optional, git-ignored) | anything non-public an operator adds | every use is marked NON-PUBLIC in the output |

Precedence when sources disagree on a label: registry over Atlas (the Atlas lags the registries by weeks), Atlas over registry for policy text. Every citation names its source so a reader can weigh it.

## Keeping the tables fresh

`scripts/sync-labels.ts` asks GitHub for the head commit of each source repo, re-reads the files, and writes `labels/*.json` only when something changed. It exits 0 (nothing), 10 (only the pinned commits moved) or 20 (a label changed). The daily workflow commits a pin-only bump directly and opens a pull request for a label change. The page compares the pinned commits with the current heads at load time and shows a banner when a source has moved.

Change rate measured on 2026-09-04: the Atlas had 33 commits on `main` since 2026-08-05, but only 2 address lines changed in the Spark article and 2 in the Grove article over three weeks; the registries had 6 (Spark) and 2 (Grove) commits. Expect one to three pull requests a month.

## Known gaps

- No public source labels an OEA Safe address. The OEA seat therefore grades WARN at best. Publishing the OEA Safes in the Atlas Ozone article (A.6.1.2.2) or a Soter-published registry would turn it PASS.
- The Atlas labels the Spark Morpho guardian Safe as "Spark Foundation"; the registry only calls it MORPHO_GUARDIAN_MULTISIG. Neither says who the signers are. The tool shows both citations and the signer set and leaves the judgment to the reader.
- The Grove registry commit pinned in the original hand-off was superseded; the sync pins whatever the branch head is when it runs and records it.
