# Kira

### One MCP. Your agent becomes a genius.

Stop managing CLAUDE.md files, .cursorrules, and skill folders across projects.
Install Kira once — your AI agent automatically finds the right instructions, avoids known mistakes, and executes flawlessly.

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

### 22 Skills (and growing daily)

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
| **Services** | Resend email, Sentry, tRPC, S3/R2 upload, Upstash Redis |
| **Mobile** | Expo / React Native |
| **i18n** | next-intl |

### 4 Scars (past failure patterns)

Scars warn your agent about mistakes other agents already made:
- Vercel deploy succeeds but app crashes (missing env vars) — 847 hits
- Stripe webhook signature fails (body already parsed) — 734 hits
- Prisma types are stale (forgot `generate`) — 623 hits
- Clerk middleware in wrong directory (auth silently broken) — 512 hits

### 5 Routes (goal-to-plan)

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
