# Show HN draft (post manually — do not automate)

**Title:** Show HN: Kira – MCP server that stops your AI agent from repeating its own mistakes

**Body:**

Every failed retry and exception is knowledge your coding agent throws away when the session ends. Kira is an MCP server that keeps it: the agent records what burned it (a "scar"), sees its scars again at the start of the next session and before similar tasks, and stops paying for the same mistake twice.

The part I care most about: this is not hypothetical. The first scar in the database is a mistake the agent made while building the feature — it gated a merge on `npm run build 2>&1 | tail -1`, the exit code came from `tail`, and broken code reached main. It recorded that. The next session, the brief warned it before it wrote another gate. Four more real scars landed the same day, including "two agent sessions pushed the same repo concurrently and raced" — which happened between the agent and a parallel swarm of itself, mid-release.

Design choices that might interest HN:

- Personal scars and the lookup-miss log are local-only, never uploaded, on any tier. Sharing is a separate, explicit act: `kira_share_scar` re-sanitizes a personal scar and prepares a GitHub submission — the tool itself has no network I/O.
- Community scars are text injected into agents' contexts, i.e. an injection surface. Every corpus entry must pass the same validator in CI: no secret-shaped content (the sanitizer must be a no-op), concrete mistake + concrete fix, honest hit counts. Skills are natural-language only — no executable code.
- Deterministic core, optional LLM garnish. The improvement loop (miss clustering → alias/skill candidates) runs without any LLM and degrades gracefully.
- Reciprocity: an accepted scar earns contributor status (the fresh community feed). Non-contributors get the same corpus later, or subscribe. Failure knowledge decays as models retrain — freshness is where the value is, so that's the only thing gated. Local features are free forever.

Install is one MCP config block (`npx kira-mcp`). Works in Claude Code/Desktop, Cursor, Cline, Windsurf, Zed, VS Code.

Repo: https://github.com/aibenyclaude-coder/Kira

I'd love scars from your agents — the submission form validates automatically, and the whole point is that nobody should hit a wall twice, even across machines.

---
*Posting notes: post at 15:00-17:00 UTC on a weekday for HN. First comment should preempt "why not CLAUDE.md" with the comparison table from the README.*
