# Verified contract ABIs

Fetched on 2026-09-04 from Blockscout's verified-source endpoint (keyless), for reference and for deriving function selectors:

| File | Contract | Address used |
|---|---|---|
| VaultV2.json | Morpho Vault V2 | 0xb0c424116172B55CbB6dD3136F5989F7959e5B91 (sparkUSDTbc, Ethereum) |
| MorphoMarketV1AdapterV2.json | Vault V2 market adapter | 0xEF4cB7e87f212F128f0b24cf35861E52B3C78A6a (adapter of sparkUSDTbc) |
| MetaMorphoV1_1.json | MetaMorpho v1.1 | 0x56A76b428244a50513ec81e225a293d128fd581D (sparkUSDCbc, Ethereum) |
| MorphoBlue.json | Morpho Blue | 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb |
| VaultV2Factory.json | Vault V2 factory | 0xA1D94F746dEfa1928926b84fB2596c06926C0405 |
| MetaMorphoFactory.json | MetaMorpho v1.1 factory | 0x1897A8997241C1cD4bD0698647e4EB7213535c24 |
| RateLimits.json | Prime ALM RateLimits | 0x5F5cfCB8a463868E37Ab27B5eFF3ba02112dF19a (Grove, Ethereum) |

The code uses the human-readable fragments in `src/sources/onchain/abis.ts`; these JSON files are the source they were checked against.
