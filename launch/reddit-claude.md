# Reddit r/ClaudeAI

## Title
I built an MCP that auto-manages skills for Claude Code — no more copying CLAUDE.md between projects

## Body
Hey everyone,

I got frustrated with managing CLAUDE.md files across projects. Every time I'd start something new, I'd copy rules, forget to update them, end up with conflicting instructions...

So I built **Kira** — an MCP server that does all of this automatically.

### What it does
- You install one MCP (3 lines of JSON config)
- Claude automatically looks up proven instructions before every task
- It also reads "Scars" — past failure patterns from other agents
- For broad goals ("build a web app"), it generates a full multi-step route

### Example
You say "deploy to Vercel." Without Kira, Claude might forget to check env vars → app crashes → retry loop.

With Kira, Claude calls `kira_lookup("deploy vercel")` and gets:
- Step-by-step deployment instructions
- A Scar warning: "847 agents forgot env vars — run `vercel env ls` first"
- Result: deploys correctly on the first try

### What's inside
- 22 skills (Vercel, Supabase, Stripe, Prisma, Clerk, Docker, Tailwind, etc.)
- 4 scars (real failure patterns with hit counts)
- 5 routes (multi-step plans like "build a web app" → 8 steps)
- Works with Claude Code, Cursor, Cline — any MCP client

### Install
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
npm: https://www.npmjs.com/package/kira-mcp

First 1,000 contributors get permanent free access to all future features.

Happy to answer any questions!
