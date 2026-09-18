# Morpho Vault Checker

Live page: https://morpho-vault-policy-check-production.up.railway.app

A proof of concept that checks a Morpho vault against the BA Labs "Morpho Vaults v2 Eligibility Criteria", the rules Sky's Core Council set for vaults that Sky's Prime agents may put money into. Give it a vault address; it returns one card per criterion with PASS, WARN or FAIL, the values it found, and where each fact came from.

Two principles shape everything below. **Every fact is read twice, by two independent methods**, and the two are shown side by side; a disagreement is displayed, never resolved by the tool. **Every claim about who controls an address comes from a public source**, cited to the file and line, never from memory or private notes.

## Glossary

| Term | Meaning |
|---|---|
| Vault | A Morpho contract that takes deposits of one asset and lends them into markets. Vault V2 is the current design; MetaMorpho v1.1 is the older one. |
| Loan asset | The asset a vault accepts and lends, such as USDC. |
| Market | A Morpho lending pool: one loan asset against one collateral asset. |
| Collateral, LLTV | The asset borrowers pledge, and the maximum loan-to-value ratio the market allows. |
| IRM | Interest rate model, the formula that sets a market's rate. |
| Oracle | The price feed a market uses to value its collateral. |
| Adapter | The contract through which a Vault V2 reaches its markets. |
| Owner | The role with ultimate control of a vault. |
| Curator | The role that sets a vault's risk parameters, under timelocks. |
| Allocator | The role that moves a vault's funds between markets. |
| Sentinel | The role that can veto or revoke pending changes; called the guardian on v1.1. |
| Timelock | The delay between announcing a protected change and executing it. |
| Abdicate | To disable a curator function permanently. |
| Safe | A multi-signature wallet. "2/3" means two of three signers must approve. Most roles are held by Safes. |
| Prime | One of Sky's capital-allocating agents: Spark, Grove, Osero, Keel, Skybase. |
| OEA | The Operational Executor Agent, Sky's operations role. It co-signs the curator and holds a sentinel seat. |
| Allocation System | The Prime machinery that moves funds. A Prime can allocate to a vault only if its rate-limit contract holds a deposit limit for that vault. |
| Rate limit | The on-chain cap on how much, and how fast, a Prime may deposit into a vault. |
| Spell | An on-chain governance action that changes such settings. |
| Atlas | Sky's constitution, a public GitHub repository. |
| Address registry | A Prime's public list of its own contract addresses, on GitHub. |

## Sources

All public. Nothing from internal wallet trackers or private notes.

| Source | What it supplies | How it is reached |
|---|---|---|
| Chain state (method A) | everything about the vault as it is on-chain: roles, markets, caps, timelocks, adapters, Safe signers, Prime positions and rate limits | one public node per chain (publicnode), every read pinned to one block, folded into Multicall3 calls; Etherscan's proxy as failover on the chains it covers |
| Morpho API (method B) | the same vault facts as Morpho indexes them, the vault universe, TVL, positions, oracle types | `https://blue-api.morpho.org/graphql`, keyless; field names verified by introspection |
| Safe Transaction Service | owners, threshold and version of every Safe in a role, as the second source next to on-chain reads | `https://api.safe.global/tx-service/<eth\|base\|robinhood>`, keyless |
| Prime address registries | who owns which contract: SubProxies, executors, ALM proxies, rate-limit contracts, curator and guardian Safes, tokens | GitHub: `grove-labs/grove-address-registry`, `sparkdotfi/spark-address-registry`, `osero-io/osero-address-registry`, `skybase-foundation/skybase-address-registry`, `ElodinLTD/keel-address-registry`; one Solidity file per chain, parsed at the branch head; every entry keeps file, line, constant and commit |
| The Atlas | role addresses and their holders for Sky's Morpho instances, governance accounts | GitHub `sky-ecosystem/next-gen-atlas`, `content/` folder; every address is recorded with its section number, line and the entity named for it on that line |
| Morpho curator registry | which addresses belong to which external curator (Steakhouse Financial, Sentora, Sky Money, and others) | the API's `curators` query |
| The criteria document | the rules themselves | BA Labs' "Morpho Vaults v2 Eligibility Criteria", encoded as data in `config/policy.json` and rendered as `docs/POLICY.md`; the mapping from each line of the document to a check, with the open questions, is `docs/POLICY_MAPPING.md` |
| The Sky forum | spells that will onboard a vault before the chain shows it | read by a person or agent during an update; entries go into `config/vault-overrides.json` with the proposal link |

Label sources disagree occasionally. Precedence: a registry over the Atlas for addresses, since the Atlas lags the registries by weeks; the Atlas over a registry for policy text. Every citation names its source, so a reader can weigh it.

Chains: Ethereum, Base and Robinhood Chain are the accepted ones. A vault on any other chain the API indexes is identified and fails the chain check; without a configured node every card there shows "one method only".

## Methodology

### Two methods for every value

1. The address is looked up on every chain the Morpho API indexes. One hit gives the chain and the version. Several hits ask for the chain.
2. Method B reads the full vault state from the API and the structure of every role Safe from the Safe service, one level of nesting.
3. Method A pins a block (latest minus a small per-chain margin) and reads the vault, its adapters, the markets, the caps, the timelocks, the Safes and the Prime positions from the public node. Things chain state cannot enumerate on its own, such as the sentinel list, the allocator list and markets that only have a cap, are taken from method B and confirmed one by one on-chain.
4. Both results are normalised into the same shape. Each check grades the on-chain values and lists the API values next to them. The block number and timestamp of every read are kept.

When the two methods disagree on a value a check depends on, the card is tagged "methods disagree" and shows both values. Usual causes: the API lagging the chain by a few blocks, a market the adapter cannot enumerate, or a real data problem. A person decides; the tool never does. Some values exist on one side only: adapter timelocks and Prime rate limits are chain-only, oracle types and the factory confirmation are API-only. Those lines say so.

### Who controls an address

An address is attributed to an entity when a public source says so: a registry constant, an Atlas line, or a curator-registry entry. That gives it a side: Prime, external curator, OEA, or unknown. Two extensions and one limit:

- **Pair statements.** When the Atlas names the two parties of a 2/2 curator Safe and one half is already labelled as the external curator, the other half is attributed to the OEA. The composition is public even though the inner Safe is not named on its own.
- **Signer overlap.** An unlabelled Safe that shares a signer with a labelled Safe is attributed "by signer overlap". That is evidence, not attestation: it can lower a verdict, for instance when a supposedly independent sentinel shares people with the curator, but it can never raise one to PASS.
- **Keys are never identified.** The tool compares signer keys, for instance to confirm a sentinel's signers are separate from the curator's, but never asks who the people behind them are. Attribution stops at the Safe.

### Criteria

The verdict is graded on the on-chain value. Card colour: PASS, WARN, FAIL for the seven graded criteria; INFO for the five context items, which are reported but never graded. The card is the worst of its parts.

| # | Criterion | Rule |
|---|---|---|
| C1 | Chain | Ethereum, Base or Robinhood: PASS. Anything else: FAIL. |
| C2 | Loan asset | The vault's asset must be on the per-chain list, matched by address: USDC, USDT, PYUSD, RLUSD, USDG. USDS is accepted in this tool although the document does not list it, pending BA Labs confirmation. Otherwise FAIL. |
| C3 | Collateral, LLTV and IRM | Every market that holds at least one whole unit of the asset, or has a cap set, must use accepted collateral (ETH, cbBTC, wstETH, WBTC at up to 86 %; sUSDS at up to 96.5 %) and the Adaptive Curve IRM. Non-accepted collateral or an LLTV above the maximum: FAIL when money is allocated, WARN when only a cap is set. A symbol that matches but an address nobody lists: WARN. An IRM that Morpho Blue reports disabled: FAIL. A vault with no such markets: n/a. |
| C4 | Owner | The Prime's governance address, the SubProxy on Ethereum or the Prime's executor on other chains: PASS. A Safe that includes it but needs every signer: WARN, a veto without control. Anything else: FAIL. |
| C5 | Curator | A 2/2 Safe of one external curator and the OEA: PASS, when the OEA half is labelled directly or a public source names the pair. The same 2/2 with a second half nobody names: WARN. A Prime or the OEA curating alone, as on Spark's own vaults: WARN, an open question. The external curator alone, or a curator no source can place: FAIL. |
| C6 | Sentinel / Guardian | At least one seat must be an OEA Safe whose signers are separate from the curator's: PASS when the Safe is labelled directly, WARN when attributed only by overlap or shape, FAIL when absent. Every extra seat is judged too: a Prime-owned Safe is allowed; the curator address itself in a seat is FAIL; any other party (the external curator, a Safe sharing the curator's signers, an unattributed contract) is WARN, an open question. On v1.1 the guardian is the seat. |
| C7 | Timelocks | Each protected function is compared with the document's table (vault and adapter functions). Below the minimum: FAIL. Two functions must carry no delay at all, add/remove allocator and the force-deallocate penalty; a delay there is FAIL. Abdication is accepted only on the four rows the document marks "/Abdicated" (three of the gates and the adapter registry) and fails every other row whatever the timelock reads. v1.1 has one vault-wide timelock and is reported only. |
| C8 | Version and factory | Vault V2 or MetaMorpho v1.1, confirmed as an official factory deployment on-chain and by being indexed. FAIL only if the factory denies the vault. |
| C9 | Allocators | Listed with their labels. The Morpho Public Allocator is acceptable per the document; it is labelled as such once its address is cited in the policy. |
| C10 | Oracles | Each market's oracle address, read by both methods, with the oracle type the API reports. Report-only until the document's oracle rules are final. |
| C11 | Fees | Performance and management fees and their recipients. Report-only, the document says "TBD". |
| C12 | Sky exposure | Each Prime's position in the vault and whether its rate-limit contract allows deposits, with the limit. Context, not a criterion. |

Exact reads behind each criterion, for anyone reproducing them: C2 `asset()` and the token's `symbol()`; C3 Morpho Blue `idToMarketParams`, `market`, `position` and `isIrmEnabled` for every market id, V2 ids from the adapter and the API's cap-only markets confirmed through `absoluteCap`, v1.1 ids from the queues; C4 to C6 the role getters plus Safe `getOwners`, `getThreshold` and `VERSION`, sentinels and allocators confirmed with `isSentinel` and `isAllocator`; C7 `timelock(bytes4)` and `abdicated(bytes4)` per function, selectors derived from the signatures, adapter timelocks on the adapter; C8 `isVaultV2` / `isMetaMorpho` on the factory; C12 `balanceOf` and `convertToAssets` per Prime ALM proxy and `getRateLimitData` on each Prime rate-limit contract with the key `keccak256(abi.encode(keccak256("LIMIT_4626_DEPOSIT"), vault))`. The API side uses `vaultV2ByAddress` / `vaultByAddress`, the position queries per proxy, and `curators`.

### The Sky vault list

The picker offers the vaults that matter to Sky, and that list is generated, not typed. Every vault the API indexes on the chains that have a Prime rate-limit contract (about 4,100 on six chains) is checked on-chain: does any Prime rate-limit contract hold a deposit limit with a non-zero maximum for it? A vault is listed if a Prime can allocate to it that way, if a Prime holds a position in it, if a cited spell is about to onboard it, or if it is one of Skybase's own vaults, found through Sky Money's entry in the curator registry and listed by Morpho in its app. Ownership, registry constants and Atlas mentions are recorded but never list a vault on their own, so superseded and test deployments stay out. A limit zeroed by a later spell is an offboarding. `docs/VAULTS.md` is the readable version.

An optional cross-check works from the other direction, because the Morpho API does not index every vault the factories created. It collects every rate-limit key each Prime contract ever set from the contracts' own event logs, reads each live, and matches them against keys computed for every API vault, every factory-created vault confirmed by the factory itself, every registry address and every counterparty of the Prime proxies, under every key prefix found in the controllers' verified source code. A live deposit limit for a Morpho vault missing from the list fails the run. About four minutes; explorer logs come from Etherscan, Blockscout on Base and Optimism, and the official Robinhood node.

## Limits and open questions

- **Structure is provable; identity partly.** Safe thresholds, signer sets, signer disjointness, timelocks, caps and LLTVs come straight from the chain. Prime and external-curator identity comes from the registries, the Atlas and the curator registry. OEA identity is attested only where the Atlas states it, as it now does for Spark's instances; where it doesn't, as for the two new Grove vaults, the OEA seats grade WARN with the reason. Publishing those Safe addresses in the Atlas turns them PASS with no change to the tool.
- **The Morpho API is incomplete by construction.** Several hundred factory-created vaults are not indexed, which is why the cross-check exists. One such vault held a live Spark deposit limit from March to July 2026.
- **The IRM reference on Robinhood** comes from Morpho's API rather than a registry, and its bytecode differs in size from Ethereum's; a registry entry would settle it.
- **Open questions for BA Labs**, listed with the tool's current reading in `docs/POLICY_MAPPING.md`: whether the 2/2 curator rule applies to Prime-self-curated vaults; whether a single key on the OEA side of the 2/2 is acceptable; whether third parties may hold extra sentinel seats; the severity of a timelock below minimum; and USDS, and DAI, as loan assets.
- An operator can add non-public labels in a git-ignored `config/local-labels.json`; every use is marked NON-PUBLIC in the output.

## Run, update, deploy

```bash
npm ci
npm run check -- check 0xb0c424116172B55CbB6dD3136F5989F7959e5B91   # one vault, chain detected; --chain 4663 to force
npm run check -- batch                                               # every listed vault; reports under tmp/reports/
npm run dev                                                          # the page on http://localhost:5173
npm test                                                             # 67 tests: rules, parsers, rate-limit keys, recorded verdicts, no personal names
```

No key is needed. With `ETHERSCAN_API_KEY` in a git-ignored `.env`, Etherscan becomes the failover node; on the deployed page it is reached through the server's proxy route, which forwards only a short allow-list of read-only calls, so the page never carries a key.

Four things are baked into the page at build time and refreshed only by an update: the label tables, the vault list, the Safe-signer table and the generated docs. `npm run update` refreshes them in order and prints what changed; `docs/UPDATE.md` says when to run it, how to handle pending spells from the forum, what to look at in the diff, and how to push and deploy. Nothing runs on a schedule; the page shows a banner when a source repository has moved since the last update. Deploys are manual: after a push, Railway's "Deploy Latest Commit".

## Repository map

```
config/policy.json          the criteria as data: chains, assets, collateral and LLTVs, timelock rules, severities, role rules
config/providers.json       nodes per chain, Morpho API, Safe service, Etherscan, block margins
config/registries.json      which GitHub repositories are label sources and how files map to chains
config/sky-vaults.json      the generated vault list; config/vault-overrides.json holds the pending spells
labels/                     generated label tables with provenance: registry, atlas, curators, safes
docs/                       POLICY_MAPPING.md and UPDATE.md (written); POLICY.md, ADDRESS_BOOK.md, SAFES.md, VAULTS.md (generated)
src/core/                   the pure part: the checks, report assembly, rate-limit key logic; no I/O
src/sources/                readers: chain (viem, Multicall3, failover), Morpho API, Safe service, labels
src/pipeline.ts, src/cli.ts find the vault, read both methods, grade, report
src/web/, server/           the page, and the server that serves it with the Etherscan proxy
scripts/                    update and its four steps, the cross-check, fixture recording
tests/                      the 67 tests
CLAUDE.md                   what an agent needs to know before touching the repository
```

## Conventions

No personal names anywhere in the repository or its outputs; entities and roles only (BA Labs, Soter Labs, Grove, Spark, Steakhouse, Sentora). No secrets in the repository. Every rule change is a change to `config/policy.json`, cited to the criteria document.
