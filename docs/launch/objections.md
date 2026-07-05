# Launch-day objections & honest answers (internal prep — not a post)

Prepared responses for predictable HN/Reddit pushback. Rules: concede what's
true, answer with specifics, link code, never argue tone. If a critique is
correct → "You're right" + fix PR + link, same thread.

---

**"Corpus with hit_count 1 everywhere — this database is tiny / seeded."**
True and stated: 38 skills / 21 scars, and every scar was actually hit — most
of them by the agent that built this, during the release you're reading about.
We chose honest 1s over fake 847s (the fake number existed in an early draft;
removing it is a commit you can read). The bet isn't the current size, it's
the absorption machine: sanitized promotion + validating intake bot + review +
reciprocity. Growth rate is public — the badge can't lie, CI enforces it.

**"Injecting community text into my agent = prompt injection as a service."**
It's THE risk, and it's engineered against, not waved away: every entry must
be sanitizer-stable (no secret shapes) in CI, natural-language-only (no code
execution), schema-validated at intake, and human-reviewed before merge.
SECURITY.md names corpus injection as in-scope with private reporting. Also:
the corpus is MIT text in a public repo — audit it entirely before installing.

**"How is this different from mem0 / zep / knowledge-graph memory servers?"**
Different job. Those remember what happened; Kira remembers what must never
happen again, in an avoidance-shaped schema (mistake/instead/severity/
recurrence) with a pre-task heat-map. Run both — no conflict. (README section
"Not another memory MCP?" has the table-level version.)

**"Claude Code-specific tools like this exist (hooks-based mistake trackers)."**
Genuinely good ones. Kira's differences: MCP-portable (same scars in Claude
Code, Cursor, Cline, Windsurf, Zed), zero local model dependency
(deterministic core; LLM strictly optional), and the community layer — a
reviewed, reciprocal corpus rather than private mining only.

**"90-day paywall on an MIT repo is theater — I can read git."**
Correct, and RECIPROCITY.md says exactly that: "a social contract enforced by
defaults, not DRM." The sanctioned feed is a convenience; the ask is: if the
fresh corpus saves you time, either feed it one scar or fund the review that
keeps it trustworthy. Everything is commons within 90 days, forever.

**"The agent wrote this project / this post."**
Yes — openly (the awesome-list PR carries the ecosystem's declared-agent
convention). The first scar in the database is a mistake the agent made while
building the feature, caught by its own gate the next session. That loop
running for real is the product claim; the transcript-level receipts are in
the commit history.

**"Telemetry."**
Off-switchable, anonymous-by-default, free text never leaves without explicit
`full` consent, double-sanitized (client + server), full wire format in
PRIVACY.md, and `npm run demo:privacy` shows exactly what would leave. The
personal scar store and miss log never upload, on any tier — that's load-bearing
for the whole design.

**"Why should I star this?"**
Don't star it — install it, hit a wall, watch the brief warn you next session.
Star it when that happens. (Says exactly this in the launch post; do not beg.)
