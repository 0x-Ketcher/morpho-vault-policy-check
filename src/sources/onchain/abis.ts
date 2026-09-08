import { parseAbi, toFunctionSelector } from "viem";

/** Human-readable ABI fragments. Cross-checked against the verified JSON ABIs in /abi (Blockscout, 2026-09-04). */

export const vaultV2Abi = parseAbi([
  "function owner() view returns (address)",
  "function curator() view returns (address)",
  "function isSentinel(address) view returns (bool)",
  "function isAllocator(address) view returns (bool)",
  "function isAdapter(address) view returns (bool)",
  "function adaptersLength() view returns (uint256)",
  "function adapters(uint256) view returns (address)",
  "function timelock(bytes4) view returns (uint256)",
  "function abdicated(bytes4) view returns (bool)",
  "function asset() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function performanceFee() view returns (uint96)",
  "function managementFee() view returns (uint96)",
  "function performanceFeeRecipient() view returns (address)",
  "function managementFeeRecipient() view returns (address)",
  "function forceDeallocatePenalty(address) view returns (uint256)",
  "function adapterRegistry() view returns (address)",
  "function receiveSharesGate() view returns (address)",
  "function sendSharesGate() view returns (address)",
  "function receiveAssetsGate() view returns (address)",
  "function sendAssetsGate() view returns (address)",
  "function absoluteCap(bytes32) view returns (uint256)",
  "function relativeCap(bytes32) view returns (uint256)",
  "function allocation(bytes32) view returns (uint256)",
  "function maxRate() view returns (uint64)",
  "function liquidityAdapter() view returns (address)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

export const adapterAbi = parseAbi([
  "function marketIdsLength() view returns (uint256)",
  "function marketIds(uint256) view returns (bytes32)",
  "function timelock(bytes4) view returns (uint256)",
  "function abdicated(bytes4) view returns (bool)",
  "function skimRecipient() view returns (address)",
  "function morpho() view returns (address)",
  "function parentVault() view returns (address)",
  "function adapterId() view returns (bytes32)",
  "function realAssets() view returns (uint256)",
  "function supplyShares(bytes32) view returns (uint256)",
  "function expectedSupplyAssets(bytes32) view returns (uint256)",
  "function ids((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)) view returns (bytes32[])",
]);

export const metaMorphoAbi = parseAbi([
  "function owner() view returns (address)",
  "function curator() view returns (address)",
  "function guardian() view returns (address)",
  "function timelock() view returns (uint256)",
  "function fee() view returns (uint96)",
  "function feeRecipient() view returns (address)",
  "function skimRecipient() view returns (address)",
  "function isAllocator(address) view returns (bool)",
  "function supplyQueueLength() view returns (uint256)",
  "function supplyQueue(uint256) view returns (bytes32)",
  "function withdrawQueueLength() view returns (uint256)",
  "function withdrawQueue(uint256) view returns (bytes32)",
  "function config(bytes32) view returns (uint184 cap, bool enabled, uint64 removableAt)",
  "function asset() view returns (address)",
  "function MORPHO() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalAssets() view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

export const morphoBlueAbi = parseAbi([
  "function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function market(bytes32) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32, address) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function isIrmEnabled(address) view returns (bool)",
]);

export const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function VERSION() view returns (string)",
]);

export const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export const rateLimitsAbi = parseAbi([
  "function getRateLimitData(bytes32) view returns ((uint256 maxAmount, uint256 slope, uint256 lastAmount, uint256 lastUpdated))",
]);

export const vaultV2FactoryAbi = parseAbi(["function isVaultV2(address) view returns (bool)"]);
export const metaMorphoFactoryAbi = parseAbi(["function isMetaMorpho(address) view returns (bool)"]);

export const selectorOf = (signature: string): `0x${string}` => toFunctionSelector(signature);
