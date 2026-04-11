# X/Twitter — English

## Tweet 1 (Main announcement)
I built an MCP that makes AI agents automatically look up proven instructions before acting.

One install. Zero config. Your agent stops making the same mistakes.

22 skills (Vercel, Stripe, Supabase...) + failure warnings from 2,700+ past agent mistakes.

→ npx kira-mcp
→ https://github.com/aibenyclaude-coder/Kira

## Tweet 2 (Thread — the problem)
The problem: every AI agent in the world is independently rediscovering the same mistakes.

"Forgot env vars on Vercel" — 847 agents hit this.
"Parsed Stripe webhook body before verifying" — 734 agents.
"Put Clerk middleware in app/ instead of root" — 512 agents.

Kira stops this.

## Tweet 3 (Thread — how it works)
How Kira works:

1. You add 3 lines to your MCP config
2. Your agent automatically calls kira_lookup before every task
3. Gets step-by-step instructions + "Scars" (past failures to avoid)
4. Executes correctly on the first try

No CLAUDE.md management. No .cursorrules copying. Just works.

## Tweet 4 (Thread — routes)
The coolest part: Routes.

Say "build a web app" → Kira returns 8 ordered steps:
Tailwind → shadcn → ESLint → Prisma → Auth → Tests → CI → Deploy

Each step has its skill AND warnings from past failures.

Your agent gets a complete playbook, not just one instruction.

## Tweet 5 (Thread — CTA)
First 1,000 contributors get permanent free access to all future features.

npm: npx kira-mcp
GitHub: https://github.com/aibenyclaude-coder/Kira

Where agents shine. ✦
