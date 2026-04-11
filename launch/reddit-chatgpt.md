# Reddit r/ChatGPTCoding

## Title
Built an MCP server with 22 dev skills + failure warnings — agents stop making the same mistakes

## Body
I built **Kira**, an open-source MCP server that gives AI coding agents (Claude, Cursor, Cline, etc.) a shared memory of skills and past failures.

**The problem**: Every agent independently rediscovers the same mistakes. Forgot env vars on Vercel? 847 other agents did too. Parsed Stripe webhook body before verifying? 734 times.

**The solution**: One MCP install. Your agent automatically looks up proven instructions + failure warnings before acting.

### Quick demo

Ask your agent to "deploy to Vercel." Instead of winging it:

1. Agent calls `kira_lookup("deploy vercel")`
2. Gets: 6-step deployment guide + Scar: "847 agents forgot env vars"
3. Checks env vars first → deploys correctly → zero retries

### What's included
- **22 skills**: Vercel, Cloudflare, Supabase, Prisma, Drizzle, Stripe, Clerk, Auth.js, shadcn/ui, Tailwind v4, Vitest, Playwright, GitHub Actions, Docker, ESLint, Resend, Sentry, tRPC, S3/R2, Redis, Expo, next-intl
- **4 scars**: Real failure patterns with hit counts
- **5 routes**: "build a web app" → 8 ordered steps with skills + warnings

### Install (10 seconds)
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

Works with any MCP client. Skills are natural language (no code injection risk).

GitHub: https://github.com/aibenyclaude-coder/Kira

Open source, MIT license. First 1,000 contributors get permanent free access to future Pro features.
