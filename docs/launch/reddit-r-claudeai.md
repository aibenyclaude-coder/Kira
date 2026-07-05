# Reddit draft — r/ClaudeAI (adapt for r/mcp, r/LocalLLaMA) — post manually

**Title:** I gave my agent permanent failure memory (MCP). The first "scar" in the DB is a mistake it made while building the feature.

**Body:**

Kira is an MCP server that gives any agent a failure memory:

- Agent hits a wall → `kira_record_failure` stores a **scar** (what went wrong + what to do instead), local-only
- Next session → a brief surfaces your scars *before* work starts
- Before a risky task → `kira_premortem(goal)` returns a heat map of failure patterns that match the goal, including your own

The origin story sells itself: while building this, the agent gated a merge on a **piped build command** — the pipe's exit code masked a compile failure and broken code hit main. It recorded that scar. It never wrote that gate wrong again. The same day it also got burned by two of its own sessions pushing one repo concurrently (recorded), a UTC/JST timestamp misread (recorded), and a "we shipped the write path but nobody ever read the data back" bug (recorded — and that one became a default audit lens).

You can promote a personal scar to the shared corpus with `kira_share_scar` — it re-sanitizes everything and prepares a GitHub submission; nothing uploads without your click. Accepted scars earn contributor status (fresh-feed access). Everything eventually becomes commons; freshness is the only premium, because failure knowledge decays as models retrain.

Privacy: personal scars and miss logs never leave your machine, on any tier. Telemetry is opt-in with a local-first sanitizer (run `npm run demo:privacy` to see exactly what would leave).

Install: one MCP block, `npx kira-mcp`. Repo: https://github.com/aibenyclaude-coder/Kira

Would love to absorb your agents' scars — the whole thesis is that no agent, anywhere, should hit the same wall twice.
