# Kira

[![CI](https://github.com/aibenyclaude-coder/Kira/actions/workflows/ci.yml/badge.svg)](https://github.com/aibenyclaude-coder/Kira/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/kira-mcp.svg)](https://www.npmjs.com/package/kira-mcp)
[![npm downloads](https://img.shields.io/npm/dw/kira-mcp.svg)](https://www.npmjs.com/package/kira-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

### One MCP. Your agent becomes a genius.

Stop managing CLAUDE.md files, .cursorrules, and skill folders across projects.
Install Kira once — your AI agent automatically finds the right instructions, avoids known mistakes, and executes flawlessly.

> **Privacy by design.** Kira learns from agent outcomes via opt-in telemetry that **redacts secrets, paths, and identifiers locally before write AND server-side before storage**. Run `npm run demo:privacy` to see exactly what leaves your machine. Full wire format and opt-out in [PRIVACY.md](./PRIVACY.md).

---

## Install (10 seconds)

Add to your MCP config (`~/.claude/settings.json`, `.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "kira": {
      "command": "npx",
      "args": ["kira-mcp"]
    }
  }
}
```

That's it. Your agent now has Kira.

---

## Demo

![Kira Demo](./demo.gif)

---

## What happens

**Before Kira:** Agent deploys to Vercel, forgets env vars, app crashes. Retries 3 times. Burns tokens.

**After Kira:** Agent automatically calls `kira_lookup("deploy vercel")` before acting. Gets step-by-step instructions + a Scar warning: *"847 agents forgot env vars — run `vercel env ls` first."* Deploys correctly on the first try.

### Three tools, zero config

| Tool | What it does |
|------|-------------|
| `kira_lookup` | Give it a keyword ("stripe", "deploy", "auth") → get proven instructions + past failure warnings |
| `kira_route` | Give it a goal ("build a web app") → get an ordered plan with skills for each step |
| `kira_report` | Agent reports success/retry after each task → feeds the quality system |

### Auto-firing

You don't call Kira. **Kira tells your agent to call it.** Via MCP instructions, the agent automatically looks up skills before starting any task. You literally do nothing.

---

## What's inside

### 31 Skills (and growing daily)

| Category | Skills |
|----------|--------|
| **Deploy** | Vercel, Cloudflare Pages |
| **Database** | Prisma, Drizzle, Supabase |
| **Auth** | Clerk, Auth.js v5 |
| **Payments** | Stripe Checkout |
| **UI** | Tailwind CSS v4, shadcn/ui |
| **Testing** | Vitest, Playwright E2E |
| **CI/CD** | GitHub Actions |
| **Infra** | Docker, ESLint flat config |
| **Services** | Resend email, React Email, Sentry, tRPC, S3/R2 upload, Upstash Redis |
| **Background** | Inngest |
| **State** | Zustand, Zod validation |
| **Upload** | UploadThing, S3/R2 |
| **Observability** | PostHog analytics, Sentry |
| **Mobile** | Expo / React Native |
| **i18n** | next-intl |
| **CMS** | Payload CMS |
| **Monorepo** | Turborepo |

### 12 Scars (past failure patterns)

Scars warn your agent about mistakes other agents already made:
- Next.js "use client" directive missing — client hooks in server components
- Vercel deploy succeeds but app crashes — missing env vars
- Stripe webhook signature fails — body already parsed
- Auth.js signIn/signOut wrong import — server/client mixup
- Prisma types are stale — forgot `generate`
- Clerk middleware in wrong directory — auth silently broken
- Supabase RLS not enabled — data publicly exposed
- Tailwind v4 PostCSS config wrong — v3 plugin breaks v4
- Vitest path alias mismatch — tsconfig vs vitest.config desync
- And more — hit counts updated from real agent data

### 7 Routes (goal-to-plan)

Ask "build a web app" → Kira returns 8 ordered steps, each with its skill and scars:

```
1. Tailwind CSS v4
2. shadcn/ui
3. ESLint
4. Prisma + Scar: "don't forget prisma generate"
5. Clerk Auth + Scar: "middleware goes in root, not app/"
6. Vitest
7. GitHub Actions CI
8. Vercel Deploy + Scar: "check env vars before --prod"
```

---

## How it works

```
Your agent gets a task
    ↓
Kira auto-fires (MCP instructions)
    ↓
kira_lookup("deploy vercel", context: ["nextjs"])
    ↓
Returns: Skill (step-by-step) + Scars (what to avoid)
    ↓
Agent announces choice → follows instructions → reports result
    ↓
kira_report("community.deploy-vercel-nextjs.v1", "success")
```

Skills are natural language Markdown — no executable code, no injection risk.

---

## Why not just use CLAUDE.md?

| | CLAUDE.md / .cursorrules | Kira |
|---|---|---|
| Setup | Copy per project | Install once |
| Updates | Manual | Automatic |
| Selection | You choose | Agent chooses |
| Failure avoidance | None | Scars (past failures) |
| Multi-step planning | None | Routes |
| Quality tracking | None | success/retry scoring |
| Works across AI tools | Tool-specific | Any MCP client |

---

## Telemetry

Kira sends anonymous outcome data to a central Worker so the community can improve Skills and surface new Scars.

| Mode (`KIRA_TELEMETRY` env, or `kira_consent` MCP tool) | What leaves your machine |
|---|---|
| `off` | Nothing. Local log only. |
| `basic` *(default)* | Anonymous core: skill ID, status, anonymous UUID, kira version, OS family, Node major version, free/pro tier. **No free text.** |
| `full` | Same as basic plus **sanitized** `note` / `context` (secrets, paths, identifiers redacted). |

Full schema, redaction rules, retention, and opt-out instructions: **[PRIVACY.md](./PRIVACY.md)**.

| Env var | Default | Purpose |
|---|---|---|
| `KIRA_TELEMETRY` | (unset → `basic`) | Override consent level for this process: `off`, `basic`, `full`. |
| `KIRA_TELEMETRY_URL` | `https://kira-telemetry.workers.dev/v1/reports` | Endpoint for batch upload. |
| `KIRA_HOME` | `~/.kira` | Where consent state and the local log live. |

---

## Contributing

The first **1,000 contributors** get permanent free access to all Kira features (including future Pro tier).

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add Skills and Scars.

---

## Links

- [npm](https://www.npmjs.com/package/kira-mcp)
- [Design Philosophy](./DESIGN.md)
- [Business Plan](./PLAN.md)
- [Usage Guide](./USAGE.md)

---

**Where agents shine.**

*A [B Button Corporation](https://github.com/aibenyclaude-coder) project.*
