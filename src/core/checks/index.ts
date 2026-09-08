import type { CheckDef } from "./helpers.ts";
import { c01Version, c02Chain, c03LoanAsset, c04Collateral } from "./assets.ts";
import { c05Owner, c06Curator, c07Sentinel, c08Allocators } from "./roles.ts";
import { c09Timelocks, c10Oracle, c11Fees, c12Exposure } from "./timelocks-context.ts";

/** Graded checks first (C1-C7), context checks after (C8-C12). The export names predate the 2026-09-08 renumbering; the ids inside each check are authoritative. */
export const CHECKS: CheckDef[] = [c02Chain, c03LoanAsset, c04Collateral, c05Owner, c06Curator, c07Sentinel, c09Timelocks, c01Version, c08Allocators, c10Oracle, c11Fees, c12Exposure];
export type { CheckDef, CheckContext } from "./helpers.ts";
