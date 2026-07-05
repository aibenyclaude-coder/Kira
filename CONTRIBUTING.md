# Contributing to Kira

The first **1,000 contributors** get permanent free access to all Kira features, including future Pro tier. Your contribution is tracked by GitHub username.

## What you can contribute

| Type | File location | Difficulty |
|---|---|---|
| **Skill** (how to do something) | `skills/community/<slug>.json` | Easy |
| **Scar** (what to avoid) | `skills/scars/<slug>.json` | Easy |
| **Route** (multi-step plan) | `routes/<slug>.json` | Medium |
| **Server feature** | `src/` | Advanced |

## Writing a Skill

### 1. Pick a topic

Choose a developer tool or workflow that AI agents commonly use. Check [existing skills](./skills/community/) to avoid duplicates.

Good candidates: any tool where agents frequently retry or make mistakes.

### 2. Create the file

`skills/community/<slug>.json` — use kebab-case for the slug.

```json
{
  "id": "community.<slug>.v1",
  "keywords": ["primary keyword", "alias 1", "alias 2"],
  "contexts": ["nextjs", "react"],
  "title": "Human-readable title",
  "summary": "One sentence describing what this skill covers.",
  "source": "community",
  "declaration": "What the agent announces to the user before executing.",
  "instructions": "## Step-by-step instructions\n\n1. First step\n2. Second step\n...\n\n## Common Errors & Fixes\n\n- Error: ...\n  Fix: ...\n\n## What NOT to Do\n\n- Never ...",
  "version": "1.0.0",
  "updated_at": "2026-04-11T00:00:00Z"
}
```

### 3. Quality checklist

- [ ] **3+ keywords** — include common variations ("deploy vercel", "deploy to vercel", "vercel deploy")
- [ ] **Contexts** — specify when this skill applies (nextjs, python, etc.)
- [ ] **Numbered steps** — agents follow them in order
- [ ] **Common Errors & Fixes** — at least 2 known pitfalls
- [ ] **What NOT to Do** — at least 2 anti-patterns
- [ ] **Declaration** — what the agent says before starting (transparency)
- [ ] **No code execution** — instructions are natural language Markdown only

### 4. Validate and submit

```bash
# Validate JSON
python3 -c "import json; json.load(open('skills/community/YOUR-FILE.json'))"

# Verify it loads
npm run demo

# Open a PR
```

### Example: look at existing skills

The best reference is an existing skill. Start with:
- [`deploy-vercel-nextjs.json`](./skills/community/deploy-vercel-nextjs.json) — simple, clear structure
- [`setup-stripe-nextjs.json`](./skills/community/setup-stripe-nextjs.json) — complex multi-step skill

## Writing a Scar

Scars warn agents about mistakes other agents already made.

**The 2-minute path (recommended):** if the failure already lives in your `~/.kira/personal-scars/` (your agent recorded it with `kira_record_failure`), just ask your agent to run **`kira_share_scar(scar_id)`**. It re-sanitizes, generalizes, and hands you a prefilled submission link — nothing is uploaded until *you* open it. Or use the [scar submission form](../../issues/new?template=scar-submission.yml) directly. The intake bot validates your JSON on the spot and a maintainer reviews content before merge.

**Why share:** every accepted scar ships to every Kira user — and earns you **contributor status** (the fresh community feed that non-contributors will subscribe for; first 1,000 contributors keep it permanently free).

All submissions must pass `scripts/validate-entry.mjs` — the same gate every shipped scar passes: 3+ keywords, concrete `mistake`/`instead` (40+ chars each), honest `hit_count`, and **zero secret-shaped content** (the sanitizer must be a no-op on your text).

```json
{
  "id": "scar.<slug>.v1",
  "keywords": ["deploy vercel", "vercel deploy"],
  "contexts": ["nextjs"],
  "title": "Short description of what goes wrong",
  "summary": "One sentence.",
  "severity": "critical",
  "mistake": "Concrete description of what the agent did wrong.",
  "instead": "Concrete description of what to do instead.",
  "hit_count": 1,
  "version": "1.0.0",
  "updated_at": "2026-04-11T00:00:00Z"
}
```

**Severity levels:**
- `critical` — causes deployment failure, data loss, or security issue
- `warning` — causes retry or suboptimal result

**Quality bar:** A scar must have a **concrete mistake** and a **concrete fix**. Vague warnings ("be careful with X") are not useful.

## Writing a Route

Routes are multi-step plans for broad goals. See [`routes/`](./routes/) for examples.

## Code contributions

For server changes (`src/`):

```bash
npm install
npm run build    # must pass
npm run demo     # must complete successfully
npm test         # vitest suite (sanitizer, schema, consent, telemetry)
```

Follow the commit convention in [CLAUDE.md](./CLAUDE.md).

### Telemetry contributions

Anything touching `src/telemetry.ts`, `src/sanitize.ts`, `src/consent.ts`, or `worker/` must:

- Update **both** sanitizer copies (`src/sanitize.ts` and `worker/src/sanitize.ts`) — they intentionally do not share code at build time.
- Add fixtures to `tests/fixtures/redaction-cases.json` for any new pattern, with positive AND negative cases.
- Update [PRIVACY.md](./PRIVACY.md) if the wire format, retention, or sanitizer pattern set changes.
- Never include real secrets, real paths, or real personal data in fixtures or sample skills — use placeholder values like `sk-NOTREALNOTREALNOTREALNOTREALNOT`.

## Quality philosophy

Skills and Scars are designed for **zero-retry agent execution**. If an agent follows your skill and still needs to retry, the skill needs improvement.

We measure quality by `success` rate — the percentage of agents that complete on the first try. Skills below 50% success rate get flagged for improvement.
