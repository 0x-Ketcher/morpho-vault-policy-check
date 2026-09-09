# Sky vaults

Generated from `config/sky-vaults.json` by `npm run gen:docs`; the list itself comes from `npm run sync:vaults`.

Listed when a Prime's RateLimits contract holds a deposit rate limit for the vault (a Prime agent can allocate to it), a Prime ALM proxy holds shares in it, a Prime governance address owns it, a Prime registry or the Atlas lists it, or Sky Money (Morpho's curator registry) owns or curates it.

31 vaults; snapshot of 2026-09-09 (the page refreshes exposure and TVL live).

## Spark (exposure $332.1M)

| Vault | Chain | Version | Address | Exposure | TVL | Allocatable by | Status | Sources |
|---|---|---|---|---|---|---|---|---|
| Spark USDC Vault (sparkUSDC) | Base | v1.1 | 0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A | $284.3M | $289.8M | Spark | exposure | Spark ALM_RATE_LIMITS (sparkdotfi/spark-address-registry src/Base.sol L29) holds a LIMIT_4626_DEPOSIT key for this vault<br>Spark ALM_PROXY holds a position (Morpho API)<br>owned by Spark governance (SPARK_EXECUTOR)<br>curated by Spark's MORPHO_CURATOR_MULTISIG<br>Spark registry src/Base.sol L87 MORPHO_VAULT_SUSDC<br>Atlas A.6.1.1.1.2.6.1.3.2.1.1.2.2.1 (Spark) |
| Spark Blue Chip USDT Vault (sparkUSDTbc) | Ethereum | v2 | 0xb0c424116172B55CbB6dD3136F5989F7959e5B91 | $35.2M | $35.5M | Spark | exposure | Spark ALM_RATE_LIMITS (sparkdotfi/spark-address-registry src/Ethereum.sol L29) holds a LIMIT_4626_DEPOSIT key for this vault<br>Spark ALM_PROXY holds a position (Morpho API)<br>owned by Spark governance (SPARK_PROXY)<br>curated by Spark's MORPHO_CURATOR_MULTISIG<br>Spark registry src/Ethereum.sol L154 MORPHO_VAULT_V2_USDT<br>Atlas A.6.1.1.1.2.6.1.3.1.5.2.2.2.1 (Spark) |
| Spark Blue Chip USDC Vault (sparkUSDCbc) | Ethereum | v1.1 | 0x56A76b428244a50513ec81e225a293d128fd581D | $12.6M | $12.9M | Spark | exposure | Spark ALM_RATE_LIMITS (sparkdotfi/spark-address-registry src/Ethereum.sol L29) holds a LIMIT_4626_DEPOSIT key for this vault<br>Spark ALM_PROXY holds a position (Morpho API)<br>owned by Spark governance (SPARK_PROXY)<br>curated by Spark's MORPHO_CURATOR_MULTISIG<br>Spark registry src/Ethereum.sol L151 MORPHO_VAULT_USDC_BC<br>Atlas A.6.1.1.1.2.6.1.3.1.5.1.2.2.1 (Spark) |
| Spark DAI Vault (spDAI) | Ethereum | v1.1 | 0x73e65DBD630f90604062f6E02fAb9138e713edD9 | $957 | $1K | Spark | exposure | Spark ALM_RATE_LIMITS (sparkdotfi/spark-address-registry src/Ethereum.sol L29) holds a LIMIT_4626_DEPOSIT key for this vault<br>Spark ALM_PROXY holds a position (Morpho API)<br>owned by Spark governance (SPARK_PROXY)<br>Spark registry src/Ethereum.sol L152 MORPHO_VAULT_DAI_1<br>Atlas A.6.1.1.1.2.6.1.4.3.1.2.2.2.1 (Spark) |
| Spark USDS Vault (sparkUSDS) | Ethereum | v1.1 | 0xe41a0583334f0dc4E023Acd0bFef3667F6FE0597 | $22 | $1K | Spark | exposure | Spark ALM_RATE_LIMITS (sparkdotfi/spark-address-registry src/Ethereum.sol L29) holds a LIMIT_4626_DEPOSIT key for this vault<br>Spark ALM_PROXY holds a position (Morpho API)<br>owned by Spark governance (SPARK_PROXY)<br>curated by Spark's MORPHO_CURATOR_MULTISIG<br>Spark registry src/Ethereum.sol L153 MORPHO_VAULT_USDS<br>Atlas A.6.1.1.1.2.6.1.4.3.1.3.2.2.1 (Spark) |
| Spark Blue Chip USDT Vault (sparkUSDTbc) | Ethereum | v2 | 0x485E796E2BAc3c1834D1a6D936F166a8AB732031 | - | $1 | - | governed, empty | owned by Spark governance (SPARK_PROXY) |
| Sentora x Spark RLUSD (sxsRLUSD) | Ethereum | v2 | 0xFC8C624B6080a0a780583799f2A862DE936F6E22 | - | - | - | pending spell | owned by Spark governance (SPARK_PROXY)<br>pending: Onboarding scheduled by the September 10, 2026 Spark spell: deposit limit 10M RLUSD refilling at 100M per day. (https://forum.skyeco.com/t/28208) |
| Spark Blue Chip USDC Vault (sparkUSDCbc) | Ethereum | v1.1 | 0xfeaC08ffA38d95ec5Ed7C46c933C8891a44C5F26 | - | - | - | governed, empty | owned by Spark governance (SPARK_PROXY) |
| Spark DAI Vault (spDAI) | Ethereum | v1.1 | 0xB8C7F2a4B3bF76CC04bd55Ebc259b33a67b3b36d | - | - | - | governed, empty | owned by Spark governance (SPARK_PROXY) |
| Spark USDS Vault (sparkUSDS) | Ethereum | v1.1 | 0x515d0e660E02C2c149a025d47f352EE6cB236B93 | - | - | - | governed, empty | owned by Spark governance (SPARK_PROXY) |
| Spark USDC Vault (sparkUSDC) | Base | v1.1 | 0x305E03Ed9ADaAB22F4A58c24515D79f2B1E2FD5D | - | - | - | governed, empty | owned by Spark governance (SPARK_EXECUTOR) |
| Spark USDS Vault (sparkUSDS) | Base | v1.1 | 0x0fFDeCe791C5a2cb947F8ddBab489E5C02c6d4F7 | - | - | - | governed, empty | owned by Spark governance (SPARK_EXECUTOR) |

## Grove (exposure $288.4M)

| Vault | Chain | Version | Address | Exposure | TVL | Allocatable by | Status | Sources |
|---|---|---|---|---|---|---|---|---|
| Steakhouse Prime USDC (steakUSDC) | Base | v2 | 0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9 | $205.2M | $428.1M | Grove | exposure | Grove ALM_RATE_LIMITS (grove-labs/grove-address-registry src/Base.sol L33) holds a LIMIT_4626_DEPOSIT key for this vault<br>Grove ALM_PROXY holds a position (Morpho API)<br>Grove registry src/Base.sol L59 STEAKHOUSE_PRIME_INSTANT_V2_MORPHO_VAULT<br>Atlas A.6.1.1.2.2.6.1.3.3.2.2.2.1 (Grove) |
| Grove x Steakhouse USDC High Yield (grove-bbqUSDC) | Base | v1.1 | 0xBeEf2d50B428675a1921bC6bBF4bfb9D8cF1461A | $79.1M | $79.1M | Grove | exposure | Grove ALM_RATE_LIMITS (grove-labs/grove-address-registry src/Base.sol L33) holds a LIMIT_4626_DEPOSIT key for this vault<br>Grove ALM_PROXY holds a position (Morpho API)<br>Grove registry src/Base.sol L58 GROVE_X_STEAKHOUSE_USDC_MORPHO_VAULT<br>Atlas A.6.1.1.2.2.6.1.3.3.1.1.2.2.1 (Grove) |
| Grove x Steakhouse USDC (grove-bbqUSDC) | Ethereum | v2 | 0xBeefF08dF54897e7544aB01d0e86f013DA354111 | $4.0M | $4.0M | Grove | exposure | Grove ALM_RATE_LIMITS (grove-labs/grove-address-registry src/Ethereum.sol L96) holds a LIMIT_4626_DEPOSIT key for this vault<br>Grove ALM_PROXY holds a position (Morpho API)<br>Grove registry src/Ethereum.sol L192 GROVE_X_STEAKHOUSE_USDC_HY_V2_MORPHO_VAULT<br>Atlas A.6.1.1.2.2.6.1.3.1.7.2.2.2.1 (Grove) |
| Grove x Steakhouse USDG (groveUSDG) | Robinhood Chain | v2 | 0xBEEff039907422219Fb367e525954DDC092854d9 | $102K | $102K | Grove, Spark | exposure | Grove ALM_RATE_LIMITS (grove-labs/grove-address-registry src/Robinhood.sol L18) holds a LIMIT_4626_DEPOSIT key for this vault<br>Spark ALM_RATE_LIMITS (sparkdotfi/spark-address-registry src/Robinhood.sol L29) holds a LIMIT_4626_DEPOSIT key for this vault<br>Grove ALM_PROXY holds a position (Morpho API)<br>Atlas A.6.1.1.2.2.6.1.3.7.1.1.2.2.1 (Grove) |
| Paypal USD Main (senPYUSDmain) | Ethereum | v2 | 0xb576765fB15505433aF24FEe2c0325895C559FB2 | - | $381.8M | Grove | allocatable, no position | Grove ALM_RATE_LIMITS (grove-labs/grove-address-registry src/Ethereum.sol L96) holds a LIMIT_4626_DEPOSIT key for this vault<br>Grove registry src/Ethereum.sol L198 SENTORA_PYUSD_MAIN_V2_MORPHO_VAULT<br>Atlas A.6.1.1.2.2.6.1.3.1.7.5.2.2.1 (Grove) |
| Sentora RLUSD Main (senRLUSDv2) | Ethereum | v2 | 0x6dC58a0FdfC8D694e571DC59B9A52EEEa780E6bf | - | $347.2M | Grove | allocatable, no position | Grove ALM_RATE_LIMITS (grove-labs/grove-address-registry src/Ethereum.sol L96) holds a LIMIT_4626_DEPOSIT key for this vault<br>Grove registry src/Ethereum.sol L199 SENTORA_RLUSD_MAIN_V2_MORPHO_VAULT<br>Atlas A.6.1.1.2.2.6.1.3.1.7.6.2.2.1 (Grove) |
| Grove x Steakhouse AUSD (grove-bbqAUSD) | Ethereum | v2 | 0xBEEfF0d672ab7F5018dFB614c93981045D4aA98a | - | $41K | Grove | allocatable, no position | Grove ALM_RATE_LIMITS (grove-labs/grove-address-registry src/Ethereum.sol L96) holds a LIMIT_4626_DEPOSIT key for this vault<br>Grove registry src/Ethereum.sol L193 GROVE_X_STEAKHOUSE_AUSD_V2_MORPHO_VAULT<br>Atlas A.6.1.1.2.2.6.1.3.1.7.4.2.2.1 (Grove) |
| Grove x Steakhouse USDC High Yield (grove-bbqUSDC) | Ethereum | v1.1 | 0xBEEf2B5FD3D94469b7782aeBe6364E6e6FB1B709 | - | $11 | Grove | allocatable, no position | Grove ALM_RATE_LIMITS (grove-labs/grove-address-registry src/Ethereum.sol L96) holds a LIMIT_4626_DEPOSIT key for this vault<br>Grove registry src/Ethereum.sol L191 GROVE_X_STEAKHOUSE_USDC_MORPHO_VAULT<br>Atlas A.6.1.1.2.2.6.1.3.1.7.1.2.2.1 (Grove) |
| Steakhouse High Yield Instant (bbqPYUSD) | Ethereum | v2 | 0xd8A6511979D9C5D387c819E9F8ED9F3a5C6c5379 | - | $1 | Grove | allocatable, no position | Grove ALM_RATE_LIMITS (grove-labs/grove-address-registry src/Ethereum.sol L96) holds a LIMIT_4626_DEPOSIT key for this vault<br>Grove registry src/Ethereum.sol L196 STEAKHOUSE_PYUSD_MORPHO_VAULT<br>Atlas A.6.1.1.2.2.6.1.3.1.7.3.2.2.1 (Grove) |
| Grove x Steakhouse USDG (grove-steakUSDG) | Ethereum | v2 | 0xbeef05061FE51eA482BD1b68041353490b3a5934 | - | $1 | - | governed, empty | owned by Grove governance (GROVE_PROXY)<br>Atlas A.6.1.1.2.2.6.1.3.1.7.8.2.2.1 (Grove) |
| Grove x Steakhouse RLUSD (grove-bbqRLUSD) | Ethereum | v2 | 0xBeEff4fD39F8e48b6a6e475445D650cb11e9599F | - | - | Grove | allocatable, no position | Grove ALM_RATE_LIMITS (grove-labs/grove-address-registry src/Ethereum.sol L96) holds a LIMIT_4626_DEPOSIT key for this vault<br>Grove registry src/Ethereum.sol L194 GROVE_X_STEAKHOUSE_RLUSD_V2_MORPHO_VAULT<br>Atlas A.6.1.1.2.2.6.1.3.1.7.7.2.2.1 (Grove) |
| Grove x Steakhouse USDC (grove-steakUSDC) | Base | v2 | 0xbeef0786756810478b88982DE00F3CD7fdB8e7c7 | - | - | - | governed, empty | owned by Grove governance (GROVE_EXECUTOR) |
| Grove x Steakhouse USDC (grove-steakUSDC) | Base | v2 | 0xbeef0Eb37DdB8f88BDf167c498c6429676fF7947 | - | - | - | governed, empty | owned by Grove governance (GROVE_EXECUTOR) |

## Skybase

| Vault | Chain | Version | Address | Exposure | TVL | Allocatable by | Status | Sources |
|---|---|---|---|---|---|---|---|---|
| sky.money USDT Savings (skyMoneyUsdtSavings) | Ethereum | v2 | 0x23f5E9c35820f4baB695Ac1F19c203cC3f8e1e11 | - | $63.2M | - | Skybase vault | Sky Money in Morpho's curator registry (verified) owns or curates it |
| sky.money USDS Flagship (skyMoneyUsdsFlagship) | Ethereum | v2 | 0xE15fcC81118895b67b6647BBd393182dF44E11E0 | - | $40.4M | - | Skybase vault | Sky Money in Morpho's curator registry (verified) owns or curates it |
| sky.money USDC Risk Capital (skyMoneyUsdcRiskCapital) | Ethereum | v2 | 0x56bfa6f53669B836D1E0Dfa5e99706b12c373ecf | - | $12.4M | - | Skybase vault | Sky Money in Morpho's curator registry (verified) owns or curates it |
| sky.money USDS Risk Capital (skyMoneyUsdsRiskCapital) | Ethereum | v2 | 0xf42bca228D9bd3e2F8EE65Fec3d21De1063882d4 | - | $1.1M | - | Skybase vault | Sky Money in Morpho's curator registry (verified) owns or curates it |
| sky.money USDT Risk Capital (skyMoneyUsdtRiskCapital) | Ethereum | v2 | 0x2bD3A43863c07B6A01581FADa0E1614ca5DF0E3d | - | $550K | - | Skybase vault | Sky Money in Morpho's curator registry (verified) owns or curates it |
| sky.money USDS Risk Capital (skyMoneyUsdsRiskCapital) | Ethereum | v2 | 0xAE57b2874673C7E0f5462B598220775017094E8f | - | $1 | - | Skybase vault | Sky Money in Morpho's curator registry (verified) owns or curates it |

## Excluded by hand

Deployments the chain cannot tell apart from the real vault, removed with a cited public document (`config/vault-overrides.json`).

| Vault | Chain | Address | Reason | Source | Since |
|---|---|---|---|---|---|
| Sentora x Spark RLUSD | Ethereum | 0x13179C1551F7364370295c3D4BDD6Ce794Af5A8d | Superseded deployment of Sentora x Spark RLUSD (2026-08-31 20:35 UTC). The September 10, 2026 Spark spell proposal names 0xFC8C624B6080a0a780583799f2A862DE936F6E22 as the vault it onboards. | https://forum.skyeco.com/t/28208 | 2026-09-09 |
| Sentora x Spark RLUSD | Ethereum | 0x661eBF3f18d6Ed9a1adA581b1285cC90071798cB | Test deployment of Sentora x Spark RLUSD (two-dollar deposit, two sentinels, timelocks below policy). The September 10, 2026 Spark spell proposal names 0xFC8C624B6080a0a780583799f2A862DE936F6E22 as the vault it onboards. | https://forum.skyeco.com/t/28208 | 2026-09-09 |

