/**
 * Regenerates labels/*.json from the public sources:
 *  - Prime address registries on GitHub (Solidity constant files, one per chain), pinned to the branch head commit
 *  - the Atlas repository content/ folder (numbered Markdown articles), pinned to the branch head commit
 *  - Morpho's public curator registry (API)
 * Every entry carries file, line, constant or article, and the commit it was read at.
 * Usage: GITHUB_TOKEN=$(gh auth token) npm run sync:labels [-- --check]   (--check: exit 1 if anything changed)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getAddress } from "viem";
import { loadJson, loadEnv, p } from "../src/node/load.ts";
import { roleFromConstant, type RegistryEntry, type AtlasEntry, type CuratorEntry } from "../src/sources/labels/index.ts";
import { parseRegistrySol, parseAtlasMarkdown } from "../src/sources/labels/parse.ts";
import { MorphoApi } from "../src/sources/morpho-api/client.ts";

loadEnv();
const cfg = loadJson<{ chainByFile: Record<string, number>; registries: { prime: string; repo: string; branch: string; dir: string; skipFiles?: string[] }[]; atlas: { repo: string; branch: string; contentDir: string }; primeArticles: Record<string, string> }>("config/registries.json");
const providers = loadJson<{ morphoApi: string }>("config/providers.json");
const token = process.env.GITHUB_TOKEN;
const check = process.argv.includes("--check");

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com/${path}`, { headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}
async function raw(repo: string, sha: string, path: string): Promise<string> {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`);
  if (!res.ok) throw new Error(`raw ${res.status} for ${repo}/${path}`);
  return res.text();
}
const headSha = async (repo: string, branch: string) => (await gh<{ sha: string; commit: { committer: { date: string } } }>(`repos/${repo}/commits/${branch}`));

async function syncRegistries() {
  const entries: RegistryEntry[] = []; const commits: Record<string, string> = {}; const notes: string[] = [];
  for (const r of cfg.registries) {
    const head = await headSha(r.repo, r.branch); commits[r.repo] = head.sha;
    const files = await gh<{ name: string; path: string; type: string }[]>(`repos/${r.repo}/contents/${r.dir}?ref=${head.sha}`);
    for (const f of files.filter((x) => x.type === "file" && x.name.endsWith(".sol") && !(r.skipFiles ?? []).includes(x.name))) {
      const chainId = cfg.chainByFile[f.name.replace(/\.sol$/, "")];
      if (chainId === undefined) { notes.push(`${r.repo}/${f.path}: no chain mapping for this file name, skipped`); continue; }
      const text = await raw(r.repo, head.sha, f.path);
      for (const k of parseRegistrySol(text)) {
        entries.push({ address: getAddress(k.address), chainId, prime: r.prime, constant: k.constant, role: roleFromConstant(k.constant), file: f.path, line: k.line, repo: r.repo, commit: head.sha, url: `https://github.com/${r.repo}/blob/${head.sha}/${f.path}#L${k.line}` });
      }
    }
    console.log(`registry ${r.repo}@${head.sha.slice(0, 8)} (${head.commit.committer.date.slice(0, 10)}): ${entries.filter((e) => e.repo === r.repo).length} constants`);
  }
  return { meta: { generatedAt: new Date().toISOString(), commits, notes, count: entries.length }, entries };
}

async function syncAtlas() {
  const head = await headSha(cfg.atlas.repo, cfg.atlas.branch);
  const tree = await gh<{ tree: { path: string; type: string; size: number }[] }>(`repos/${cfg.atlas.repo}/git/trees/${head.sha}?recursive=1`);
  const files = tree.tree.filter((t) => t.type === "blob" && t.path.startsWith(`${cfg.atlas.contentDir}/`) && t.path.endsWith(".md"));
  const entries: AtlasEntry[] = []; let bytes = 0;
  for (const f of files) {
    const text = await raw(cfg.atlas.repo, head.sha, f.path); bytes += text.length;
    const fileArticle = /^content\/(A(?:\.\d+)+)\s+-\s+/.exec(f.path)?.[1] ?? null;
    const prime = fileArticle ? Object.entries(cfg.primeArticles).find(([k]) => fileArticle === k || fileArticle.startsWith(k + "."))?.[1] ?? null : null;
    for (const m of parseAtlasMarkdown(text, fileArticle, f.path)) {
      entries.push({ address: getAddress(m.address), prime, article: m.article, title: m.title, uuid: m.uuid, file: f.path, line: m.line, text: m.text, roleHint: m.roleHint, entityHint: m.entityHint, commit: head.sha, url: `https://github.com/${cfg.atlas.repo}/blob/${head.sha}/${f.path.split("/").map(encodeURIComponent).join("/")}#L${m.line}` });
    }
  }
  console.log(`atlas ${cfg.atlas.repo}@${head.sha.slice(0, 8)} (${head.commit.committer.date.slice(0, 10)}): ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB, ${entries.length} address mentions, ${new Set(entries.map((e) => e.address)).size} distinct addresses`);
  return { meta: { generatedAt: new Date().toISOString(), commits: { [cfg.atlas.repo]: head.sha }, files: files.length, bytes, count: entries.length }, entries };
}

async function syncCurators() {
  const api = new MorphoApi(providers.morphoApi);
  const items = await api.curators();
  const entries: CuratorEntry[] = items.map((c) => ({ id: c.id, name: c.name, verified: c.verified, addresses: (c.addresses ?? []).map((a) => ({ chainId: a.chainId, address: getAddress(a.address) })) }));
  console.log(`morpho curator registry: ${entries.length} curators, ${entries.reduce((n, c) => n + c.addresses.length, 0)} addresses`);
  return { meta: { generatedAt: new Date().toISOString(), source: providers.morphoApi, count: entries.length }, entries };
}

type ChangeLevel = 0 | 10 | 20; // none | meta only (pins, dates) | entries changed
function writeIfChanged(rel: string, data: { meta: unknown; entries: unknown[] }): ChangeLevel {
  const next = JSON.stringify(data, null, 1) + "\n";
  const prevText = existsSync(p(rel)) ? readFileSync(p(rel), "utf8") : "";
  let level: ChangeLevel = 20;
  if (prevText) {
    try {
      const prev = JSON.parse(prevText) as { meta: unknown; entries: unknown[] };
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      level = same(prev.entries, data.entries) ? (same(prev.meta, data.meta) ? 0 : 10) : 20;
    } catch { level = 20; }
  }
  if (!check && level > 0) writeFileSync(p(rel), next);
  console.log(`${rel}: ${level === 0 ? "unchanged" : level === 10 ? "pins/meta changed, labels unchanged" : "LABELS CHANGED"}`);
  return level;
}

function updateKnownVaults(registry: RegistryEntry[]): boolean {
  const kv = loadJson<{ note: string; vaults: { name: string; chainId: number; address: string; prime?: string; source?: string }[] }>("config/known-vaults.json");
  let added = 0;
  for (const e of registry.filter((x) => x.role === "morphoVault")) {
    if (kv.vaults.some((v) => v.address.toLowerCase() === e.address.toLowerCase() && v.chainId === e.chainId)) continue;
    kv.vaults.push({ name: `${e.prime} registry: ${e.constant}`, chainId: e.chainId, address: e.address, prime: e.prime, source: `${e.repo} ${e.file} L${e.line}` }); added++;
  }
  if (added && !check) writeFileSync(p("config/known-vaults.json"), JSON.stringify(kv, null, 2) + "\n");
  console.log(`config/known-vaults.json: ${added} vault(s) added from registries`);
  return added > 0;
}

const registry = await syncRegistries();
const atlas = await syncAtlas();
const curators = await syncCurators();
const levels = [writeIfChanged("labels/registry.json", registry), writeIfChanged("labels/atlas.json", atlas), writeIfChanged("labels/curators.json", curators)];
const level = Math.max(...levels, updateKnownVaults(registry.entries) ? 20 : 0);
if (check) { if (level === 20) { console.log("labels are out of date"); process.exit(1); } process.exit(0); }
console.log(level === 0 ? "nothing changed" : level === 10 ? "only source commits moved" : "labels changed: review the diff");
process.exit(level);
