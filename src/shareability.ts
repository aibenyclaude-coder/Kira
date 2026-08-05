/**
 * Which of your own failures would also bite someone else?
 *
 * Collection is the loop's weakest link. Recording is already automatic —
 * `kira_record_failure` fires on a retry — and sharing is one tool call away,
 * but nothing ever *asks*. A personal store grows to hundreds of scars while the
 * shared catalog stays the size of what one maintainer remembered to promote.
 *
 * The judgement a human makes here is narrow: "is this true on a machine that is
 * not mine?" A failure about a PUBLIC surface — a package manager, a CLI, a
 * hosting platform, a protocol — travels. A failure about this laptop's paths,
 * this company's internal script, or a one-off local state does not.
 *
 * So the signal is: does the scar name public surfaces, and does it avoid naming
 * private ones. Deliberately a suggestion, never an action — nothing is uploaded,
 * and the reason is returned so the caller can disagree on the spot.
 */

/**
 * Public surfaces: things that exist identically on someone else's machine.
 * Matched on word boundaries against the scar's own text, so "git" fires on
 * "git push" and not on "digit" or "legitimate".
 */
const PUBLIC_SURFACES = [
  // package + runtime
  "npm", "npx", "pnpm", "yarn", "node", "nodejs", "deno", "bun", "pip", "python",
  "cargo", "go", "composer", "gem", "maven", "gradle",
  // vcs + forge
  "git", "github", "gitlab", "gh", "pull request", "rebase", "merge", "worktree",
  // ci / release
  "github actions", "ci", "workflow", "oidc", "provenance", "semver", "changelog",
  // containers + cloud
  "docker", "kubernetes", "k8s", "aws", "gcp", "azure", "cloudflare", "vercel",
  "netlify", "fly.io", "render", "supabase", "firebase",
  // web + frameworks
  "react", "nextjs", "next.js", "vue", "svelte", "astro", "vite", "webpack",
  "tailwind", "typescript", "eslint", "prettier", "postcss",
  // data
  "postgres", "postgresql", "mysql", "sqlite", "redis", "mongodb", "prisma",
  // test
  "vitest", "jest", "playwright", "puppeteer", "cypress", "pytest",
  // media + system tools
  "ffmpeg", "imagemagick", "sharp", "whisper", "sqlite3", "systemd", "cron",
  "bash", "zsh", "curl", "jq", "sed", "awk", "ssh", "dns", "tls", "http",
  // protocols / specs
  "mcp", "oauth", "jwt", "json schema", "utf-8", "quoted-printable",
] as const;

/**
 * Private surfaces: markers that the failure is about THIS machine or THIS
 * project. Any hit blocks the suggestion outright — a false "shareable" costs a
 * maintainer a review and the author an embarrassment, so the gate is one-sided.
 */
const PRIVATE_MARKERS = [
  /\/home\/[a-z0-9_-]+\//i,
  /\/users\/[a-z0-9_-]+\//i,
  /c:\\users\\/i,
  /\blocalhost:\d+/i,
  /\b(?:192\.168|10\.\d+|127\.0\.0\.1)\b/,
  /\bmy (?:laptop|machine|desktop|pc)\b/i,
  /\bthis (?:machine|laptop|box)\b/i,
  // No \b here: JavaScript word boundaries are ASCII-only, so \b next to a CJK
  // character never matches and the whole alternation silently never fires.
  // Caught by the test that feeds it "うちの本番機だけで再現する".
  /(?:社内|自社|うちの|本機|このマシン|弊社)/,
] as const;

/**
 * A public surface alone is far too loose a filter: measured over 196 real
 * personal scars, 150 of them name npm or git or bash somewhere, and telling
 * an author to share 150 scars is not triage — it is the same silence with
 * extra steps.
 *
 * What separates the ones actually worth promoting is not vocabulary but WEIGHT,
 * and the author has already recorded it twice over:
 *
 *   severity: "critical"  — they judged the blast radius large when it happened.
 *   hit_count > 1         — it recurred. The lesson failed to stick for the very
 *                           person who wrote it down, which is the strongest
 *                           available evidence that it is a pattern and not a
 *                           one-off local accident.
 *
 * Both are facts already on disk, not inferences. Requiring either takes the
 * same 196 scars down to 31 candidates — a list a human can actually read.
 */
function carriesWeight(severity?: string, hitCount?: number): boolean {
  return severity === "critical" || (hitCount ?? 1) > 1;
}

export interface Shareability {
  shareable: boolean;
  /** Distinct public surfaces the scar names. More surfaces, wider audience. */
  surfaces: string[];
  /** One line the caller can show verbatim. */
  reason: string;
}

const WORD = /[a-z0-9][a-z0-9.+-]*/g;

/** Does `text` name `surface` as a word (not as a substring of a longer one)? */
function namesSurface(tokens: Set<string>, lower: string, surface: string): boolean {
  if (surface.includes(" ")) return lower.includes(surface);
  return tokens.has(surface);
}

/**
 * Judge one scar. `text` should be everything the author wrote — title, mistake,
 * instead, keywords, contexts — because the giveaway is as often in the fix as
 * in the description.
 */
export function judgeShareability(parts: {
  title?: string;
  mistake?: string;
  instead?: string;
  keywords?: string[];
  contexts?: string[];
  severity?: string;
  hit_count?: number;
}): Shareability {
  const text = [
    parts.title ?? "",
    parts.mistake ?? "",
    parts.instead ?? "",
    ...(parts.keywords ?? []),
    ...(parts.contexts ?? []),
  ].join("\n");
  const lower = text.toLowerCase();

  for (const marker of PRIVATE_MARKERS) {
    if (marker.test(text)) {
      return {
        shareable: false,
        surfaces: [],
        reason: "Names something specific to this machine or project — it would not reproduce elsewhere.",
      };
    }
  }

  const tokens = new Set(lower.match(WORD) ?? []);
  const surfaces = PUBLIC_SURFACES.filter((s) => namesSurface(tokens, lower, s));

  if (surfaces.length === 0) {
    return {
      shareable: false,
      surfaces: [],
      reason: "Names no third-party tool or platform, so there is no shared surface for it to fire on.",
    };
  }

  if (!carriesWeight(parts.severity, parts.hit_count)) {
    return {
      shareable: false,
      surfaces: [...surfaces],
      reason:
        "Names a shared surface but is recorded as a one-off warning — not yet enough weight to spend a reviewer's attention on.",
    };
  }

  const named = surfaces.slice(0, 3).join(", ");
  const why =
    (parts.hit_count ?? 1) > 1
      ? `it already recurred ${parts.hit_count} times here, so the lesson does not stick on its own`
      : "you recorded it as critical";
  return {
    shareable: true,
    surfaces: [...surfaces],
    reason: `Describes ${named}, and ${why} — the same failure is reachable on any machine using it.`,
  };
}
