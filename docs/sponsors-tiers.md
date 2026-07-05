# GitHub Sponsors tier copy (paste when enrolling)

## $5 / month — Supporter

**The fresh scar feed, and you fund the review that keeps it trustworthy.**

Every scar in Kira's corpus is text an AI agent will read and act on — so
every submission is validated by a bot and accepted by a maintainer. Your
sponsorship pays for that review loop and the feed infrastructure.

You get:
- A **supporter key** (`KIRA_KEY`) — the fresh community feed, no 90-day delay
- Your name in SUPPORTERS.md (opt-in)
- The warm feeling of agents everywhere hitting fewer walls

*Prefer to earn it instead? One accepted scar = a contributor key, free.
That's the whole point: [RECIPROCITY.md](../RECIPROCITY.md).*

## $50 / month — Team Supporter

Everything above, plus:
- Up to 10 supporter keys (one email → keys for your team)
- Priority triage on scar/skill submissions from your org

---

### After enrolling (maintainer notes)

1. Create the two tiers above on the Sponsors dashboard.
2. When a sponsorship lands: issue the key —
   `KIRA_SIGNING_KEY=<path> node scripts/sign-key.mjs --tier pro --sub <gh-login> --days 32`
   (31-day sponsorship cycle + 1 grace day; re-issue monthly or use --days 366 for annual).
3. Webhook automation (auto-issue on sponsorship event) is a later phase —
   volume does not justify it yet.
