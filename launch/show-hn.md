# Show HN Post

## Title
Show HN: Kira – One MCP that auto-manages skills and scars for AI agents

## URL
https://github.com/aibenyclaude-coder/Kira

## Text (paste in the text field)
I got tired of copying CLAUDE.md and .cursorrules between projects, so I built Kira — an MCP server that auto-manages skills for AI agents.

Install once (3 lines of JSON), and your agent automatically:

• Looks up proven instructions before acting (22 skills: Vercel, Stripe, Supabase, Prisma, etc.)
• Reads "Scars" — past failure patterns from other agents ("847 agents forgot env vars before deploying")
• Plans multi-step routes ("build a web app" → 8 ordered steps with skills + warnings)

The key insight: skills are natural language Markdown, not code. So there's zero injection risk, and LLM-based safety review works perfectly.

How it works: The MCP server includes an `instructions` field that tells the agent "look up skills before acting." The agent calls `kira_lookup("deploy vercel")` and gets step-by-step instructions + scars. No manual triggering needed.

npm: `npx kira-mcp`
GitHub: https://github.com/aibenyclaude-coder/Kira
Design doc: https://github.com/aibenyclaude-coder/Kira/blob/main/DESIGN.md

First 1,000 contributors get permanent free access to all future features.

Built with TypeScript + @modelcontextprotocol/sdk. Works with Claude Code, Cursor, Cline, and any MCP client.
