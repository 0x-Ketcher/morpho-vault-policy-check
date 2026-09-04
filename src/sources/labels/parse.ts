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

/** Role and entity hints for one address-bearing line, given the nearest heading title. */
export function atlasHints(line: string, heading: string): { roleHint: string | null; entityHint: string | null } {
  let roleHint: string | null = null;
  for (const [re, role] of ROLE_WORDS) if (re.test(line) || re.test(heading)) { roleHint = role; break; }
  const m1 = /^\s*-?\s*(?:Curator|Guardian|Owner|Sentinel|Allocator|Relayer|Freezer)[^:]*:\s*([A-Z][A-Za-z0-9 .&'-]{1,40}?),\s/.exec(line);
  const m2 = /held by ([A-Z][A-Za-z0-9 .&'-]{1,40}?) at/.exec(line);
  const m3 = /controlled by ([A-Z][A-Za-z0-9 .&'-]{1,40}?)[.,( ]/.exec(line);
  const entityHint = (m1?.[1] ?? m2?.[1] ?? m3?.[1] ?? null)?.trim() ?? null;
  return { roleHint, entityHint };
}

export function parseAtlasMarkdown(text: string, fileArticle: string | null, fileTitle: string): AtlasMention[] {
  const out: AtlasMention[] = [];
  let heading = { article: fileArticle ?? "", title: fileTitle, uuid: null as string | null };
  text.split("\n").forEach((line, i) => {
    const h = ATLAS_HEADING_RE.exec(line);
    if (h) { heading = { article: h[1], title: h[2].trim(), uuid: h[3] ?? null }; return; }
    const found = line.match(ADDRESS_RE);
    if (!found) return;
    const { roleHint, entityHint } = atlasHints(line, heading.title);
    for (const a of new Set(found)) out.push({ address: a, article: heading.article, title: heading.title, uuid: heading.uuid, line: i + 1, text: line.trim().slice(0, 240), roleHint, entityHint });
  });
  return out;
}
