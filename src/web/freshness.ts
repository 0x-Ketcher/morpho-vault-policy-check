import { registries, labelData } from "./data.ts";

export interface Freshness { repo: string; pinned: string; head: string | null; behind: boolean | null; error?: string }

/** Compares the commits the label tables were read at with the current branch heads. Cached for 10 minutes per browser. */
export async function checkFreshness(): Promise<Freshness[]> {
  const cacheKey = "labels-freshness-v1";
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null") as { at: number; data: Freshness[] } | null;
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.data;
  } catch { /* ignore */ }
  const pins: Record<string, string> = { ...((labelData.registry?.meta.commits as Record<string, string>) ?? {}), ...((labelData.atlas?.meta.commits as Record<string, string>) ?? {}) };
  const sources = [...registries.registries.map((r) => ({ repo: r.repo, branch: r.branch })), { repo: registries.atlas.repo, branch: registries.atlas.branch }];
  const out: Freshness[] = [];
  for (const s of sources) {
    const pinned = pins[s.repo] ?? "";
    try {
      const res = await fetch(`https://api.github.com/repos/${s.repo}/commits/${s.branch}`, { headers: { accept: "application/vnd.github+json" } });
      if (!res.ok) { out.push({ repo: s.repo, pinned, head: null, behind: null, error: `GitHub API ${res.status}` }); continue; }
      const d = (await res.json()) as { sha: string };
      out.push({ repo: s.repo, pinned, head: d.sha, behind: pinned ? d.sha !== pinned : null });
    } catch (e) { out.push({ repo: s.repo, pinned, head: null, behind: null, error: (e as Error).message }); }
  }
  try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data: out })); } catch { /* ignore */ }
  return out;
}
