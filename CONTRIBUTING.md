# Contributing to Kira

## Writing a Skill

1. Create a JSON file in `skills/community/<slug>.json`
2. Follow the schema in CLAUDE.md
3. Include at least:
   - 3+ keyword variants
   - Step-by-step instructions with numbered steps
   - "Common errors & fixes" section
   - "What NOT to do" section
4. Run `npm run demo` to verify it loads
5. Open a PR

## Writing a Scar

1. Create a JSON file in `skills/scars/<slug>.json`
2. Include:
   - A concrete `mistake` (what went wrong, in detail)
   - A concrete `instead` (what to do differently)
   - `severity`: "warning" or "critical"
   - `hit_count`: estimate how many agents hit this (start at 1)
3. Run `npm run demo` to verify it loads
4. Open a PR

## Early Contributor Perk

The first 1000 contributors get **permanent free access** to all Kira features,
including future Pro tier. Your contribution is tracked by GitHub username.

## Quality Bar

Skills and Scars are designed for **zero-retry agent execution**.
If an agent follows your skill and still needs to retry, the skill needs improvement.
