# The checks, one by one

Numbering: the graded checks are C1 to C7 in reading order, the context checks C8 to C12 follow. The hand-off of 2026-09-04 used a different order (vault version was C1, chain C2, and so on); it was renumbered on 2026-09-08 so that the graded checks come first.

Every check reads its inputs twice, from chain state (method A) and from the Morpho API (method B), normalises both into the same snapshot shape and evaluates the same rule on each. The verdict shown uses the on-chain value. When the two values differ the card is marked DISCREPANCY and both values stay visible with their block number and timestamp. Nothing is auto-resolved.

Labels (who controls an address) come from public sources only. See `docs/DATA_SOURCES.md` for the sources and `docs/ADDRESS_BOOK.md` for the current table.

| # | Check | Method A (chain state) | Method B (Morpho API) | Labels used | Verdict rule |
|---|---|---|---|---|---|
| C1 | Chain | chain id of the provider that served the reads (verified with `eth_chainId`) | `chain.id` | none | PASS if in the accepted list, else FAIL |
| C2 | Loan asset | `asset()` then ERC-20 `symbol()` | `asset { address symbol }` | address allow-list per chain in `config/policy.json` | PASS on address match; FAIL otherwise, with a note when only the symbol matches |
| C3 | Collateral, LLTV and IRM | Morpho Blue `idToMarketParams(id)` (collateral, LLTV, IRM), `market(id)`, `position(id, adapter)` for every market id, plus `isIrmEnabled(irm)`; V2 market ids from `adapter.marketIds(i)` plus the API's cap-only markets confirmed via `adapter.ids(params)` and `vault.absoluteCap(id)`; v1.1 ids from the supply and withdraw queues, caps from `config(id)` | V2 `caps { items { ... on MarketV1CapData } }` with `marketParams.irm`; v1.1 `state.allocation` with `market.irmAddress` | collateral allow-list and accepted IRM per chain | per market with an allocation (at least one whole unit) or a cap: accepted collateral within max LLTV and the accepted IRM = PASS; not accepted collateral with allocation = FAIL, cap-only = WARN; LLTV above max = FAIL/WARN; symbol matches but address unknown = WARN; wrong IRM, or accepted IRM that Morpho Blue reports disabled = FAIL with allocation, WARN cap-only; a market with no IRM (not a Morpho Blue v1 market) is not graded on IRM; card = worst |
| C4 | Owner | `owner()`; Safe `getOwners()`/`getThreshold()`/`VERSION()` if it is a contract | `owner.address` / `state.owner`; Safe Transaction Service | registry roles `subproxy` and `executor` | Prime governance address = PASS; n-of-n Safe including it = WARN; anything else = FAIL |
| C5 | Curator | `curator()`; Safe reads, one level of nesting | `curator.address` / `state.curator`; Safe service | Morpho curator registry (external curators), registry multisigs, Atlas role lines, OEA entity names | 2/2 of external curator + directly labeled OEA = PASS; external + unlabeled or inferred co-signer = WARN; Prime/OEA self-curated = WARN; external only = FAIL; unattributable = FAIL |
| C6 | Sentinel / Guardian | V2: each API-listed sentinel confirmed with `isSentinel(addr)`; v1.1: `guardian()`; Safe reads; leaf signer sets compared with the curator Safe's | `sentinels { sentinel { address } }` / `state.guardian`; Safe service | same as C5, plus the Safe-owners table for signer overlap | every seat is classified. Mandatory: one OEA Safe with signers disjoint from the curator's (directly labeled = PASS; by signer overlap or unlabeled OEA-shaped = WARN; none = FAIL). Violation: the curator address itself holds a seat = FAIL. Extras: Prime-owned = allowed; any other party (external curator, a signer of the curator Safe, a Safe sharing signers with the curator Safe, an unattributed address such as a monitoring solution) = WARN, open question for BA. Card = worst |
| C7 | Timelocks | `timelock(bytes4)` and `abdicated(bytes4)` per policy function, selectors derived from the function signatures; adapter timelocks on the adapter contract | `timelocks { selector functionName duration abdicatedAt }` (vault only; adapters have no API field) | none | every function at or above its minimum, or abdicated where allowed = PASS; any below = FAIL; v1.1 = INFO |
| C8 | Version and factory | `adaptersLength()` answers = Vault V2; `guardian()` + `timelock()` answer = MetaMorpho v1.1; `VaultV2Factory.isVaultV2(vault)` / `MetaMorphoV1_1Factory.isMetaMorpho(vault)` | `vaultV2s` vs `vaults` lookup by address; presence in the API = deployed by an official factory | none | INFO; FAIL only if the factory denies the vault |
| C9 | Allocators | each API-listed allocator confirmed with `isAllocator(addr)` | `allocators { allocator { address } }` / `allocators` | registry `almProxy`, curator registry | INFO |
| C10 | Oracles | market params `oracle` | `market { oracle { address type } }` | none | INFO until BA finalises the oracle criteria |
| C11 | Fees | `performanceFee()`, `managementFee()`, recipients; v1.1 `fee()`, `feeRecipient()` | same fields | registry (recipient attribution) | INFO |
| C12 | Sky exposure and Liquidity Layer onboarding | `balanceOf(almProxy)` and `convertToAssets(shares)` for every labeled Prime ALM proxy; `RateLimits.getRateLimitData(key)` with `key = keccak256(abi.encode(keccak256("LIMIT_4626_DEPOSIT"), vault))` | `vaultV2PositionByAddress` / `vaultPosition` per ALM proxy; rate limits have no API equivalent | registry `almProxy`, `almRateLimits` | INFO; not a policy criterion, shown as context |

## Reading a card

- PASS, WARN, FAIL: graded. INFO: reported, not graded. n/a: the check does not apply (idle vault, V2-only check on a v1.1 vault).
- DISCREPANCY: the two methods disagree on a value this check depends on. Both values are listed. Usual causes: API indexing lag (a few blocks), a market the adapter cannot enumerate, or an actual data problem. A human decides; the tool does not.
- single source: only one method can produce the value (adapter timelocks and rate limits are chain-only; the API-side factory confirmation is API-only).
- Every label line cites its source: registry file, constant and commit; Atlas article and line; Morpho curator registry entry; or "signer overlap with" a labeled Safe.

## Why inference cannot reach PASS

An unlabeled Safe that shares a signer with a labeled Safe inherits that Safe's side "by signer overlap". That is evidence, not attestation, so it can move a sentinel from WARN to FAIL (shared control with the Prime or the curator defeats the seat) but never from WARN to PASS. A PASS on the OEA seat needs a direct public label of the OEA Safe. On 2026-09-04 no public source carries one; the Atlas Ozone OEA article is the recommended place (see `docs/POLICY_MAPPING.md`).

## Every sentinel counts

The mandatory OEA seat is judged on the best candidate, but every other seat is judged too. The curator address itself in a sentinel seat is a violation on its own, whatever else is in place: the seat exists to check the curator. Prime-owned extra seats are allowed by the document. Any other party in an extra seat, the external curator, a signer of the curator Safe, a Safe sharing signers with the curator Safe, or an address no public source attributes, is WARN with the reason: the document lists only the OEA, a monitoring solution and a Prime-owned multisig as sentinels, and whether other parties may hold a seat is an open question for BA (docs/POLICY_MAPPING.md, question 4).

## Signer disjointness

The curator Safe's leaf signers are its EOA owners plus, for owner Safes, their owners (one level). A sentinel's leaf signers are computed the same way. The policy asks for a separate signer set; any intersection is reported and turns an OEA sentinel into WARN.
