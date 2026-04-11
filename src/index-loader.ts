import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill, Scar } from "./types.js";
import type { KiraTier } from "./license.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const SKILLS_ROOT = join(PROJECT_ROOT, "skills");
const CACHE_DIR = join(PROJECT_ROOT, ".cache");
const CACHE_SKILLS = join(CACHE_DIR, "remote-skills.json");
const CACHE_SCARS = join(CACHE_DIR, "remote-scars.json");

const CACHE_TTL_MS = Number(process.env.KIRA_CACHE_TTL_MS) || 3_600_000;
const PRO_CDN_URL = "https://cdn.kira.sh/v1";

function getRemoteUrl(tier: KiraTier): string {
  const explicit = process.env.KIRA_REMOTE_URL;
  if (explicit) return explicit;
  return tier === "pro" ? PRO_CDN_URL : "";
}

// ── Local loader ───────────────────────────────────────────────────────

async function readJsonDir<T>(dir: string): Promise<T[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const items: T[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const raw = await readFile(join(dir, file), "utf-8");
    items.push(JSON.parse(raw) as T);
  }
  return items;
}

async function loadLocalSkills(): Promise<Skill[]> {
  const community = await readJsonDir<Skill>(join(SKILLS_ROOT, "community"));
  const vendor = await readJsonDir<Skill>(join(SKILLS_ROOT, "vendor"));
  return [...community, ...vendor];
}

async function loadLocalScars(): Promise<Scar[]> {
  return readJsonDir<Scar>(join(SKILLS_ROOT, "scars"));
}

// ── Remote loader ──────────────────────────────────────────────────────

async function isCacheFresh(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return Date.now() - s.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

async function fetchRemote<T>(endpoint: string, cachePath: string, remoteUrl: string): Promise<T[]> {
  if (!remoteUrl) return [];

  const url = `${remoteUrl.replace(/\/$/, "")}/${endpoint}`;

  if (await isCacheFresh(cachePath)) {
    const cached = await readFile(cachePath, "utf-8");
    return JSON.parse(cached) as T[];
  }

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[kira] Remote fetch ${endpoint} failed: ${res.status}`);
      return loadCached<T>(cachePath);
    }
    const items = (await res.json()) as T[];
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath, JSON.stringify(items, null, 2), "utf-8");
    return items;
  } catch (err) {
    console.error(`[kira] Remote ${endpoint}:`, (err as Error).message);
    return loadCached<T>(cachePath);
  }
}

async function loadCached<T>(path: string): Promise<T[]> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

// ── Merge & deduplicate ────────────────────────────────────────────────

function merge<T extends { id: string; updated_at: string }>(
  local: T[],
  remote: T[]
): T[] {
  const byId = new Map<string, T>();
  for (const item of local) byId.set(item.id, item);
  for (const item of remote) {
    const existing = byId.get(item.id);
    if (
      !existing ||
      new Date(item.updated_at).getTime() >
        new Date(existing.updated_at).getTime()
    ) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

// ── Public API ─────────────────────────────────────────────────────────

export async function loadAllSkills(tier: KiraTier = "free"): Promise<Skill[]> {
  const remoteUrl = getRemoteUrl(tier);
  const [local, remote] = await Promise.all([
    loadLocalSkills(),
    fetchRemote<Skill>("skills.json", CACHE_SKILLS, remoteUrl),
  ]);
  return merge(local, remote);
}

export async function loadAllScars(tier: KiraTier = "free"): Promise<Scar[]> {
  const remoteUrl = getRemoteUrl(tier);
  const [local, remote] = await Promise.all([
    loadLocalScars(),
    fetchRemote<Scar>("scars.json", CACHE_SCARS, remoteUrl),
  ]);
  return merge(local, remote);
}
