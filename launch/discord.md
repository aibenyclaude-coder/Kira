# Discord Launch Posts

---

## Claude Code Community (Official Discord)

**Channel**: #show-and-tell or #mcp

Hey — built an MCP that solves the CLAUDE.md copy-paste problem.

**The pain**: Every new project, I'm copying CLAUDE.md, editing rules, forgetting to update them. 10 projects in and they're all out of sync.

**Kira** = one MCP install. Your agent auto-looks up the right instructions before acting. No more managing skill files.

What's inside:
- **22 skills** — Vercel, Supabase, Prisma, Stripe, Clerk, shadcn, Tailwind v4, Docker, etc.
- **Scars** — real failure patterns: "847 agents forgot env vars on Vercel deploy", "734 parsed Stripe webhook body before verifying"
- **Routes** — say "build a web app" → agent gets 8 ordered steps with skills + warnings

Install:
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

The auto-firing is the key part — Kira's `instructions` field tells Claude to call `kira_lookup` before every task. You don't trigger anything manually.

GitHub: https://github.com/aibenyclaude-coder/Kira

Open source, MIT. First 1,000 contributors get permanent free Pro access.

---

## Cursor Community

**Channel**: #show-your-work or #extensions

Made an MCP server that replaces per-project `.cursorrules` with a single auto-managed skill system.

**Problem**: .cursorrules files get stale, you copy them between projects, they conflict, and your agent has no idea which rules matter for the current task.

**Kira** handles this automatically. One MCP install → agent looks up proven instructions + avoids known failure patterns before acting.

Quick example — you ask "deploy to Vercel":
1. Agent calls `kira_lookup("deploy vercel")`
2. Gets: 6-step guide + Scar: "847 agents forgot env vars — run `vercel env ls` first"
3. Deploys correctly, zero retries

22 skills (Vercel, Stripe, Prisma, Clerk, Tailwind v4, Playwright, etc.) + routes for multi-step goals.

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

Drop that in `.cursor/mcp.json` and you're done.

GitHub: https://github.com/aibenyclaude-coder/Kira

MIT license. First 1,000 contributors → permanent free Pro.

---

## Cline Community

**Channel**: #showcase or #mcp-servers

Open-source MCP server for agent skill management — **Kira**.

Instead of each agent independently figuring out how to deploy to Vercel or set up Stripe, Kira gives them a shared knowledge base of proven instructions + past failure patterns.

What makes it different from a static rules file:
- **Auto-selection** — agent describes its task, Kira returns the matching skill
- **Scars** — warnings from 2,700+ past agent mistakes (e.g., "don't parse Stripe webhook body before verifying signature")
- **Routes** — multi-step planning ("build a web app" → 8 ordered steps)
- **Fuzzy matching** — "deploy", "database", "auth" all resolve to the right skill

22 skills, 4 scars, 5 routes. All natural language Markdown — no executable code, no injection risk.

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

Works with any MCP client. TypeScript, MIT license.

GitHub: https://github.com/aibenyclaude-coder/Kira
npm: https://www.npmjs.com/package/kira-mcp

First 1,000 contributors get permanent free access to future Pro features. Skill contributions welcome — it's one JSON file per skill.

---

## Japanese Discord (もくもく会 / AI系サーバー)

AIエージェント用のMCPサーバー「**Kira**」を公開した。

**課題**: CLAUDE.mdや.cursorrulesをプロジェクトごとにコピーして管理するのが破綻する。10個超えたら矛盾するルールだらけ。

**解決**: MCP 1個入れるだけ。エージェントが作業前に自動でスキル検索 → 正しい手順 + 過去の失敗警告を取得 → 一発で成功。

中身:
- **22スキル**: Vercel, Supabase, Prisma, Stripe, Clerk, shadcn, Tailwind v4, Docker, etc.
- **Scar（傷跡）**: 「Vercelデプロイで環境変数忘れ」847回、「Stripeのwebhookでbody先にparse」734回
- **ルート**: 「Webアプリ作りたい」→ 8ステップの作戦書が降ってくる

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

GitHub: https://github.com/aibenyclaude-coder/Kira

OSSでMITライセンス。最初の1,000 Contributorは将来のPro機能も永久無料。スキル1本（JSON 1ファイル）書いてPR出すだけでOK。
