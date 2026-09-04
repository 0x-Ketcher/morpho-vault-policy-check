import type { Address } from "../../core/types.ts";

export interface SafeServiceInfo {
  address: Address;
  owners: Address[];
  threshold: number;
  version: string;
  nonce: number;
}

/** Safe Transaction Service (public, keyless). Returns null when the address is not a Safe known to the service. */
export async function fetchSafe(baseUrl: string | undefined, address: Address, fetchImpl: typeof fetch = fetch): Promise<SafeServiceInfo | null | "unavailable"> {
  if (!baseUrl) return "unavailable";
  try {
    let res = await fetchImpl(`${baseUrl}/api/v1/safes/${address}/`, { headers: { accept: "application/json" } });
    if (res.status === 404) return null;
    if (!res.ok) { await new Promise((r) => setTimeout(r, 1500)); res = await fetchImpl(`${baseUrl}/api/v1/safes/${address}/`, { headers: { accept: "application/json" } }); }
    if (res.status === 404) return null;
    if (!res.ok) return "unavailable";
    const d = (await res.json()) as { address: string; owners: string[]; threshold: number; version: string; nonce: number | string };
    return { address: d.address as Address, owners: d.owners as Address[], threshold: Number(d.threshold), version: d.version, nonce: Number(d.nonce) };
  } catch {
    return "unavailable";
  }
}
