# Reciprocity — share a scar, or subscribe, or wait

Kira's community corpus grows when people who hit walls share them. This page
is the deal that keeps that loop fair. It was designed around one observation:

> **Failure knowledge decays.** A scar about a breaking change matters most
> before the models retrain past it. Freshness is where the value
> concentrates — so freshness is the only thing that isn't immediately free.

## The three ways to be current

| You | You get |
|---|---|
| **Share** — one accepted community scar | A **contributor key**: the fresh feed, free, for 12 months per accepted scar. The **first 1,000 contributors keep it permanently.** |
| **Support** — sponsor the project | A **supporter key**: same fresh feed, plus you fund review & infrastructure. |
| **Wait** — do neither | The same corpus, **90 days later**, plus the full base corpus that ships with every npm release. Nothing is ever locked away forever. |

## Free forever, regardless

- All local features: `kira_record_failure`, `kira_personal_brief`,
  `kira_premortem`, `kira_lookup` over the shipped corpus, the flywheel.
- All privacy guarantees: personal scars and miss logs never leave your
  machine, on any tier. The corpus fetch is a plain pull — no telemetry rides
  on it, and the free tier makes **no network calls at all** unless you opt in
  (`KIRA_REMOTE_URL`).
- The repository itself: MIT, public, forkable. This gate is a **social
  contract enforced by defaults, not DRM** — a determined free-rider can read
  the git history; the sanctioned channel, the convenience, and the ethics are
  what's gated. We think that's enough, and the delayed commons keeps it fair.

## How keys work

- Set `KIRA_KEY` in your MCP server's env (legacy `KIRA_PRO_KEY` still works).
- Keys are ES256-signed JWTs verified offline by the client and by the feed
  endpoint. Invalid/expired keys degrade to the free tier — never an error.
- Earn one: submit a scar ([2-minute guide](./CONTRIBUTING.md#writing-a-scar),
  or just run `kira_share_scar` in your agent). When it's merged, comment your
  GitHub handle on the PR and a maintainer issues your key.

## Enforcement status: grace mode

Until the community corpus reaches **100 community scars**, the fresh feed is
open to everyone — keys are already issued and honored, but nothing is
delayed. The gate turns on when the corpus is genuinely worth subscribing to;
this document will be updated when that happens. (Constitution:
[FLYWHEEL.md](./FLYWHEEL.md), decision log 2026-07-06.)

## Why charge at all?

Review is the expensive part. Every submitted scar is validated by a bot but
**accepted by a human** — that's what keeps a corpus injected into your
agent's context safe to trust. Supporter money and contributor labor are the
two currencies that pay for that trust.
