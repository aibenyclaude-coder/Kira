# Kira — Project Rules

> Where agents shine.

## What is Kira

MCP server that auto-manages Skills (how to do it) and Scars (what to avoid) for AI agents.
One install, zero maintenance.

## Architecture

- `src/` — TypeScript MCP server
- `skills/community/` — Community skills (JSON)
- `skills/vendor/` — Vendor skills (JSON, 審査制)
- `skills/scars/` — Scars: past failure patterns (JSON)
- `DESIGN.md` — Design philosophy and decisions
- `PLAN.md` — Full business plan

## Skill JSON Schema

```json
{
  "id": "community.<slug>.v1",
  "keywords": ["firing keyword"],
  "contexts": ["nextjs", "react"],
  "title": "Human-readable title",
  "summary": "One-line.",
  "source": "community",
  "declaration": "What agent announces before executing.",
  "instructions": "## Markdown step-by-step",
  "version": "1.0.0",
  "updated_at": "2026-04-11T00:00:00Z"
}
```

## Scar JSON Schema

```json
{
  "id": "scar.<slug>.v1",
  "keywords": ["firing keyword"],
  "contexts": ["nextjs"],
  "title": "What went wrong",
  "summary": "One-line.",
  "severity": "critical",
  "mistake": "What the agent did wrong.",
  "instead": "What to do instead.",
  "hit_count": 100,
  "version": "1.0.0",
  "updated_at": "2026-04-11T00:00:00Z"
}
```

## Development Rules

1. **Build check**: Always run `npm run build` after editing src/
2. **Demo check**: Always run `npm run demo` after any change to verify all skills load
3. **Skill quality**: Every skill must have Common Errors + What NOT to do sections
4. **Scar quality**: Every scar must have concrete mistake + concrete instead
5. **Keywords**: Include at least 3 keyword variants per skill
6. **Contexts**: Always specify project context tags
7. **No code in skills**: Skills are natural language Markdown instructions only
8. **Validate JSON**: All JSON files must be valid (run `python3 -c "import json; json.load(open('path'))"`)

## Commit Convention

- Skill additions: `add skill: <title>`
- Scar additions: `add scar: <title>`
- Server changes: `server: <description>`
- Infrastructure: `infra: <description>`

## Priority Order for Autonomous Work

When picking tasks autonomously:
1. Fix broken skills (success rate dropped)
2. Write scars for known failure patterns
3. Write skills for missing keywords (lookup misses)
4. Improve server features
5. Update documentation
