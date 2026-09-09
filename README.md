# Morpho vault policy check

Proof of concept for the AI team. It checks a Morpho vault against the BA Labs "Morpho Vaults v2 Eligibility Criteria", and it does every check twice, from two independent methods, using public sources only. It is meant as the template for the binary-criteria case; the less binary criteria are being built separately.

- Input: a vault address, on any chain the Morpho API indexes. The chain is detected; it can also be given.
- Output: one card per check with PASS / WARN / FAIL / info / n/a, the value each method found, the label sources cited, and a DISCREPANCY mark when the two methods disagree. Nothing is auto-resolved.
- Sources: chain state through public JSON-RPC nodes (method A), the Morpho GraphQL API (method B), the Safe Transaction Service for Safe structure, and, for labels, the Prime address registries on GitHub, the Atlas and Morpho's curator registry.

Live checks take about 15 seconds per vault (around 140 chain reads folded into a handful of Multicall3 calls, two providers, plus the API).

## Run it

```bash
npm ci
npm run check -- check 0xb0c424116172B55CbB6dD3136F5989F7959e5B91          # one vault, chain detected
npm run check -- check 0xBEEff039907422219Fb367e525954DDC092854d9 --chain 4663
npm run check -- batch                                                      # every vault in config/known-vaults.json
npm run check -- find 0x…                                                   # which chains know this vault
```

Reports are written as JSON and Markdown under `tmp/reports/` (or `--out <dir>`). No key is needed. If `ETHERSCAN_API_KEY` is set in the environment or in a git-ignored `.env`, Etherscan becomes a third, failover on-chain provider on the chains it covers.

The page:

```bash
npm run dev          # Vite dev server on http://localhost:5173, keyless
npm run build && npm start   # production: Express serves dist/ and the /api/etherscan proxy on $PORT (default 3000)
```

The page runs every read in the visitor's browser. It never contains a key. If the server has `ETHERSCAN_API_KEY`, the page reaches Etherscan through the server's proxy route, which forwards only a short allow-list of read-only calls, accepts same-origin requests only and rate-limits per client. A visitor may also paste their own key in the settings; it stays in their browser.

## How a check works

1. The address is looked up on every chain the Morpho API indexes (`vaultV2s` / `vaults` filtered by address). One hit gives the chain and the version (Vault V2 or MetaMorpho v1.1). Several hits ask for the chain. No hit: the tool tries to identify a vault from chain state and reports that the second method is unavailable.
2. Method B reads the full vault state from the API and the Safe structure of every role address from the Safe Transaction Service, one level of nesting.
3. Method A pins a block (latest minus a per-chain margin), then reads the vault, its adapters, the Morpho Blue markets, the caps, the timelocks, the Safes and the Prime positions through Multicall3 on the first public node, and replays every batch on the second node at the same block. Candidates that chain state cannot enumerate (sentinels, allocators, cap-only markets) come from method B and are confirmed one by one on-chain.
4. Both results are normalised into the same snapshot shape. Each check evaluates the on-chain snapshot and lists the API value next to it. If a value the check depends on differs, the card is marked DISCREPANCY with both values, block number and timestamp.
5. Labels come from `labels/*.json`, generated from public sources with file, line, constant, article and commit for every entry. An unlabeled Safe that shares a signer with a labeled Safe is attributed "by signer overlap", which can lower a verdict but never raise it to PASS.

The rules per check are in `docs/CHECKS.md`. The mapping from the BA document to the checks, with the open interpretation questions, is in `docs/POLICY_MAPPING.md`. The sources, their quirks and the freshness mechanism are in `docs/DATA_SOURCES.md`.

## Discrepancy policy

Never auto-resolve. Show both values, mark the card, record the block number and timestamp of each read. When a human must choose: chain state over API state; the registries over the Atlas for labels (the Atlas lags the registries by weeks); the Atlas over the registries for policy text. Every label cites file and constant, or article and line.

## What public sources cannot prove

Structure is provable: Safe versions, thresholds, owner sets, signer disjointness, timelocks, caps, LLTVs. Prime-side and curator-side identity is provable from the registries, the Atlas and Morpho's curator registry. OEA identity is not: on 2026-09-04 no public source labels the OEA sentinel Safes or the OEA co-signers, so those seats grade WARN with the exact reason. Publishing the OEA Safe addresses in the Atlas Ozone OEA article (A.6.1.2.2) or in a Soter-published registry would turn them PASS; the label sync would pick either up. An operator can add non-public labels in a git-ignored `config/local-labels.json`; every use is marked NON-PUBLIC in the output.

## Repository map

```
config/policy.json         the policy as data: chains, loan assets, collateral and max LLTV, timelock minimums, severities, role rules
config/providers.json      RPC endpoints per chain, Morpho API, Safe service, Etherscan, pinned-block margins
config/registries.json     which GitHub repos are label sources and how file names map to chains
config/known-vaults.json   quick-pick list: the September 2026 review vaults plus every vault constant in the registries
labels/                    generated label tables with provenance (registry, atlas, curators, safes)
docs/                      POLICY.md, ADDRESS_BOOK.md, SAFES.md (generated); CHECKS.md, DATA_SOURCES.md, POLICY_MAPPING.md (written)
abi/                       verified ABIs the human-readable fragments were checked against
src/core/                  the pure part: types, checks (one file group per check), report assembly, renderers; no I/O
src/sources/               readers: onchain (viem, Multicall3, failover), morpho-api, safe, etherscan transport, labels
src/pipeline.ts            find vault, read both methods, evaluate, report
src/cli.ts                 check / batch / find
src/web/                   the page (Vite + React), reads everything in the browser
server/index.ts            production server: static files plus the key-holding Etherscan proxy
scripts/                   sync-labels, read-safes, gen-docs, record-fixtures
tests/                     unit tests on synthetic snapshots, parser tests, regression on recorded snapshots, repository scrub
```

## Configuration is data

Change the policy in `config/policy.json` and regenerate `docs/POLICY.md` with `npm run gen:docs`. Add a chain by adding its providers to `config/providers.json` (and its accepted assets to the policy if it is accepted). Add a label source by adding the repo to `config/registries.json`. The checks read the config; nothing about the policy lives in code except the shape of a rule.

## Labels and freshness

`npm run sync:labels` (set `GITHUB_TOKEN` to `gh auth token` to avoid the anonymous API limit) re-reads the registries at their branch heads, the whole Atlas `content/` folder and Morpho's curator registry, and rewrites `labels/*.json` only when something changed. `npm run read:safes` re-reads the owners of every known Safe on-chain and via the Safe service. `npm run gen:docs` rewrites the three generated tables. CI fails if the generated docs are stale.

The daily `label-sync` workflow does the same on a schedule: a run that finds nothing changes nothing; a pin-only move is committed directly; a label change opens a pull request with the diff for review. The page compares the pinned commits with the current heads when it loads and shows a banner when a source has moved.

## Tests and CI

```bash
npm run typecheck
npm test                       # unit + parser + regression (recorded snapshots vs tests/fixtures/expected_verdicts.json) + scrub
npm run gen:docs -- --check    # generated tables are current
```

The scrub test fails if any personal name from `SCRUB_TERMS` (a regex kept out of the repo, set locally or as a CI secret) or any Etherscan-key-shaped token appears in repository text. Entity and role names only.

`npm run record:fixtures` records the two snapshots of every vault in `tests/fixtures/expected_verdicts.json` so the regression test runs offline. Re-record after a deliberate rule change and update the expected verdicts in the same commit.

## Deployment

Production: https://morpho-vault-policy-check-production.up.railway.app (Railway, SoterLabs workspace, service `morpho-vault-policy-check`, deploys from `main` on push).

Railway: `railway.json` sets the build command to `npm run build` only, because Railway's builder installs dependencies itself in a cache mount and a second `npm ci` fails with EBUSY. Start command `npm start`, health check `/api/health`. `ETHERSCAN_API_KEY` is set as a service variable so the proxy route works; without it the page runs keyless. Any Node host works the same way.

## Conventions

No personal names anywhere in this repository or its outputs. People are referred to by entity or role (BA Labs, Soter GovOps, Soter Tech PM, Grove, Spark, Steakhouse, Sentora). The scrub test enforces it.
