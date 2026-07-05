# Security Policy

Kira's threat model is unusual and worth stating plainly: **the corpus is text
that AI agents read and act on.** A malicious or sloppy corpus entry is an
injection vector into every agent that installs Kira. We treat corpus content
with supply-chain rules, and we want to hear about anything that weakens them.

## Reporting a vulnerability

Use **GitHub private vulnerability reporting** (Security tab → "Report a
vulnerability") on this repository. You'll get a response within 72 hours.
Please do not open public issues for exploitable problems.

In scope, especially:

- **Corpus injection** — any way to get executable payloads, secret-shaped
  content, or manipulative instructions past the intake validator
  (`scripts/validate-entry.mjs`), the corpus lint (`tests/corpus-lint.test.ts`),
  or human review.
- **Sanitizer bypasses** — text that survives `src/sanitize.ts` (client) or
  `worker/src/sanitize.ts` (server) while still carrying secrets, paths, or
  identifiers. The two copies must stay equivalent.
- **Privacy-promise violations** — any path by which personal scars
  (`~/.kira/personal-scars/`) or the miss log leave the machine without the
  documented explicit action.
- **Key/tier verification flaws** — forged `KIRA_KEY` acceptance in
  `src/license.ts` or `worker/src/corpus.ts` (ES256, ieee-p1363).
- **Release-rail weaknesses** — ways around the tag-ancestry check, ref gates,
  or checksum pinning in `.github/workflows/`.

## Out of scope

- The 90-day delayed commons being readable from the public git history —
  that is by design (RECIPROCITY.md: a social contract, not DRM).
- Vulnerabilities in MCP client applications themselves.

## Supported versions

Only the latest published minor receives fixes (`npm view kira-mcp version`).
