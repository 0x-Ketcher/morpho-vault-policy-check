import { registries, labelData } from "./data.ts";

export interface Freshness { repo: string; pinned: string; head: string | null; behind: boolean | null; error?: string }
export interface HeadRead { repo: string; head: string | null; error?: string }

/** The verdict is always computed from the current pins; only the heads are ever cached, so a new deploy can never show a stale banner. */
export function compareHeads(pins: Record<string, string>, heads: HeadRead[]): Freshness[] {
  return heads.map((h) => { const pinned = pins[h.repo] ?? ""; return { repo: h.repo, pinned, head: h.head, behind: h.head && pinned ? h.head !== pinned : null, error: h.error }; });
}

/** Compares the commits the label tables were read at with the current branch heads. The heads are cached for 10 minutes per browser. */
export async function checkFreshness(): Promise<Freshness[]> {
  const cacheKey = "labels-heads-v2";
  const pins: Record<string, string> = { ...((labelData.registry?.meta.commits as Record<string, string>) ?? {}), ...((labelData.atlas?.meta.commits as Record<string, string>) ?? {}) };
  const sources = [...registries.registries.map((r) => ({ repo: r.repo, branch: r.branch })), { repo: registries.atlas.repo, branch: registries.atlas.branch }];
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null") as { at: number; heads: HeadRead[] } | null;
    if (cached && Date.now() - cached.at < 10 * 60_000 && sources.every((s) => cached.heads.some((h) => h.repo === s.repo))) return compareHeads(pins, cached.heads);
  } catch { /* ignore */ }
  const heads: HeadRead[] = [];
  for (const s of sources) {
    try {
      const res = await fetch(`https://api.github.com/repos/${s.repo}/commits/${s.branch}`, { headers: { accept: "application/vnd.github+json" } });
      if (!res.ok) { heads.push({ repo: s.repo, head: null, error: `GitHub API ${res.status}` }); continue; }
      const d = (await res.json()) as { sha: string };
      heads.push({ repo: s.repo, head: d.sha });
    } catch (e) { heads.push({ repo: s.repo, head: null, error: (e as Error).message }); }
  }
  try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), heads })); } catch { /* ignore */ }
  return compareHeads(pins, heads);
}
