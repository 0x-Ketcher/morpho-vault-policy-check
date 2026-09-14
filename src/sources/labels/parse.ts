/** Parsers for the two text sources. Kept free of I/O so they can be unit-tested on excerpts. */

export const ADDRESS_RE = /(?<![0-9a-zA-Z])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
export const REGISTRY_LINE_RE = /address\s+(?:internal|public|private)?\s*constant\s+(\w+)\s*=\s*(0x[0-9a-fA-F]{40})\s*;/;
export const ATLAS_HEADING_RE = /^#+\s+(A(?:\.\d+)+)\s+-\s+(.*?)\s*(?:<!--\s*UUID:\s*([0-9a-f-]+)\s*-->)?\s*$/;

export interface RegistryConstant { constant: string; address: string; line: number }

export function parseRegistrySol(text: string): RegistryConstant[] {
  const out: RegistryConstant[] = [];
  text.split("\n").forEach((line, i) => {
    const m = REGISTRY_LINE_RE.exec(line);
    if (m) out.push({ constant: m[1], address: m[2], line: i + 1 });
  });
  return out;
}

export interface AtlasMention { address: string; article: string; title: string; uuid: string | null; line: number; text: string; roleHint: string | null; entityHint: string | null }

const ROLE_WORDS: [RegExp, string][] = [
  [/curator/i, "curator"], [/guardian/i, "guardian"], [/sentinel/i, "sentinel"], [/allocator/i, "allocator"], [/owner/i, "owner"],
  [/relayer/i, "relayer"], [/freezer/i, "freezer"], [/token address|underlying asset/i, "token"], [/rate ?limit/i, "rateLimit"],
  [/proxy/i, "proxy"], [/executor/i, "executor"], [/multisig|safe/i, "multisig"],
];

const ENTITY = "([A-Z][A-Za-z0-9 .&'-]{1,40}?)";
/** "Curator: Soter Labs, implemented via …", "Cancellation Authority: Spark Foundation, implemented via …" */
const LINE_PREFIX_RE = new RegExp(`^\\s*-?\\s*(?:Curator|Guardian|Owner|Sentinel|Allocator|Relayer|Freezer|Cancellation Authority)[^:]*:\\s*${ENTITY},\\s`);
/** Phrases that name the holder of the multisig whose address follows: "held by the Spark Foundation multisig at", "together with a Soter Labs multisig at", "controlled by Grove" */
const SEGMENT_RES = [
  new RegExp(`(?:held by|controlled by|together with|and|with)\\s+(?:the |a |an )?${ENTITY}\\s+(?:multisig|Gnosis Safe multisig|Safe)\\b`),
  new RegExp(`held by ${ENTITY} at`),
  new RegExp(`controlled by ${ENTITY}[.,( ]`),
];

/** Holder phrases that follow an address: "is controlled by Grove", "held by the Spark Foundation" */
const AFTER_RES = [new RegExp(`(?:is |are )?(?:controlled|held) by (?:the |a |an )?${ENTITY}(?:'s)?(?:\\s+(?:multisig|Safe))?(?:[.,;(]|$)`)];

/** Role and entity hints for one address-bearing line, given the nearest heading title. */
export function atlasHints(line: string, heading: string): { roleHint: string | null; entityHint: string | null } {
  let roleHint: string | null = null;
  for (const [re, role] of ROLE_WORDS) if (re.test(line) || re.test(heading)) { roleHint = role; break; }
  return { roleHint, entityHint: entityHintFor(line, null) };
}

/**
 * The entity named for one address on a line. A line can name several Safes ("held by the Spark Foundation multisig at
 * 0x…, together with a Soter Labs multisig at 0x…"), so the phrase closest before the address wins; a "Role: Entity,"
 * prefix applies to every address on the line when no closer phrase names one. `address` null: the line as a whole.
 */
export function entityHintFor(line: string, address: string | null): string | null {
  const at = address ? line.indexOf(address) : -1;
  const before = at >= 0 ? line.slice(0, at) : line;
  const prev = address ? Math.max(...[...before.matchAll(/0x[0-9a-fA-F]{40}/g)].map((m) => (m.index ?? 0) + 42), 0) : 0;
  const segment = before.slice(prev);
  let best: { index: number; entity: string } | null = null;
  for (const re of SEGMENT_RES) { const m = re.exec(segment); if (m && (!best || m.index > best.index)) best = { index: m.index, entity: m[1].trim() }; }
  if (best) return best.entity;
  // "… at 0x… is controlled by Soter Labs." names the holder after the address; stop at the next address on the line
  if (at >= 0) {
    const rest = line.slice(at + 42);
    const next = rest.search(/0x[0-9a-fA-F]{40}/);
    const after = next >= 0 ? rest.slice(0, next) : rest;
    for (const re of AFTER_RES) { const m = re.exec(after); if (m) return m[1].trim(); }
  }
  const prefix = LINE_PREFIX_RE.exec(line);
  return prefix ? prefix[1].trim() : null;
}

export function parseAtlasMarkdown(text: string, fileArticle: string | null, fileTitle: string): AtlasMention[] {
  const out: AtlasMention[] = [];
  let heading = { article: fileArticle ?? "", title: fileTitle, uuid: null as string | null };
  text.split("\n").forEach((line, i) => {
    const h = ATLAS_HEADING_RE.exec(line);
    if (h) { heading = { article: h[1], title: h[2].trim(), uuid: h[3] ?? null }; return; }
    const found = line.match(ADDRESS_RE);
    if (!found) return;
    const { roleHint } = atlasHints(line, heading.title);
    for (const a of new Set(found)) out.push({ address: a, article: heading.article, title: heading.title, uuid: heading.uuid, line: i + 1, text: line.trim().slice(0, 240), roleHint, entityHint: entityHintFor(line, a) });
  });
  return out;
}
