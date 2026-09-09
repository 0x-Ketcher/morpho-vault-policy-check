# Data sources

All public. No internal wallet trackers, no Notion, no private registries. Verified on 2026-09-04 unless stated.

## Chain state (method A)

One public node per chain, publicnode on all three, chosen on 2026-09-09 after timing the candidates on a 46-read stage: publicnode 0.41 s median, 1RPC 0.55 s with batching off, Merkle rate-limited real use, Cloudflare returned internal errors. Etherscan's proxy is slower by construction: one call per HTTP request and, on this key's plan, three calls per second, so a full vault check would spend ten seconds in throttling alone. It stays configured as a failover behind the public node for Ethereum and Base; it does not cover Robinhood.

| Chain | Provider | Notes |
|---|---|---|
| Ethereum (1) | publicnode | answers browser requests, JSON-RPC batches of 10 and `eth_call` at a pinned block |
| Base (8453) | publicnode | same |
| Robinhood Chain (4663) | publicnode | same; reads pinned 5 blocks back; the Blockscout explorer sits behind a bot challenge and is unusable as an API |
| other Morpho chains | one publicnode endpoint where known, otherwise none | a vault on a chain without a provider is identified via the API and fails the chain check; every card shows "one method only" |

How reads work: every read in a run is pinned to one block (latest minus a per-chain margin) and folded into Multicall3 `aggregate3` calls, one `eth_call` per stage. The report states the provider, the block, the timestamp and the read count. If the node fails mid-run the reader fails over to the next configured endpoint at the same block. The two-method comparison the tool promises is chain state against the Morpho API; there is no node-against-node comparison.

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

## The Sky vault list

Definition, in order of strength: a Prime's RateLimits contract holds a `LIMIT_4626_DEPOSIT` key for the vault, so a Prime agent can allocate to it; a Prime ALM proxy holds shares in it; a Prime governance address owns it; a Prime registry or the Atlas lists it; Sky Money, a verified entry in Morpho's curator registry, owns or curates it. The universe scanned is every vault the Morpho API indexes on the accepted chains, about 3,800 on 2026-09-09; the rate-limit question is one Multicall read per vault per Prime contract, a few seconds per chain on publicnode. RateLimits, ALM proxy and governance addresses come from the registries. Rebuilt by `scripts/sync-vaults.ts`; rendered as `docs/VAULTS.md`. Exceptions live in `config/vault-overrides.json`, each with a public source: superseded or test deployments are excluded, and a vault a scheduled spell will onboard is marked pending until the chain shows its rate limit.

## Keeping the tables fresh

`scripts/sync-labels.ts` asks GitHub for the head commit of each source repo, re-reads the files, and writes `labels/*.json` only when something changed; the run timestamp alone is not a change, so a quiet day leaves the repository untouched. It exits 0 (nothing), 10 (only the pinned commits moved) or 20 (a label changed). The daily workflow commits a pin-only bump directly and opens a pull request for a label change. The page compares the pinned commits with the current heads at load time and shows a banner when a source has moved.

Change rate measured on 2026-09-04: the Atlas had 33 commits on `main` since 2026-08-05, but only 2 address lines changed in the Spark article and 2 in the Grove article over three weeks; the registries had 6 (Spark) and 2 (Grove) commits. Expect one to three pull requests a month.

## Known gaps

- The accepted interest rate model is registry-published for Ethereum and Base (Spark registry `MORPHO_DEFAULT_IRM`) but not for Robinhood. There the reference address (`0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1`) comes from the Morpho API market data, and Morpho Blue on Robinhood (`0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`, read from the adapter's `morpho()`) reports it enabled. The deployed bytecode differs in size from the Ethereum contract, so a bytecode comparison does not settle it; a registry entry would.

- No public source labels an OEA Safe address. The OEA seat therefore grades WARN at best. Publishing the OEA Safes in the Atlas Ozone article (A.6.1.2.2) or a Soter-published registry would turn it PASS.
- The Atlas labels the Spark Morpho guardian Safe as "Spark Foundation"; the registry only calls it MORPHO_GUARDIAN_MULTISIG. Neither says who the signers are. The tool shows both citations and the signer set and leaves the judgment to the reader.
- The Grove registry commit pinned in the original hand-off was superseded; the sync pins whatever the branch head is when it runs and records it.
