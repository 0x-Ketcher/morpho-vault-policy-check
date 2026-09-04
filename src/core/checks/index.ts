import type { CheckDef } from "./helpers.ts";
import { c01Version, c02Chain, c03LoanAsset, c04Collateral } from "./c01-c04.ts";
import { c05Owner, c06Curator, c07Sentinel, c08Allocators } from "./c05-c08.ts";
import { c09Timelocks, c10Oracle, c11Fees, c12Exposure } from "./c09-c12.ts";

export const CHECKS: CheckDef[] = [c01Version, c02Chain, c03LoanAsset, c04Collateral, c05Owner, c06Curator, c07Sentinel, c08Allocators, c09Timelocks, c10Oracle, c11Fees, c12Exposure];
export type { CheckDef, CheckContext } from "./helpers.ts";
