# Kira Telemetry Privacy

Kira reports the outcome of skill applications back to a central service so the community can improve Skills and surface new Scars. This document describes **exactly what is sent, how it is sanitized, how to opt out, and how long it is kept**.

If you find a discrepancy between this document and the code, the code is the bug — please open an issue.

---

## TL;DR

| Setting (`KIRA_TELEMETRY` env, or `kira_consent` MCP tool) | What leaves your machine |
|---|---|
| `off` | **Nothing.** Reports are still appended to `~/.kira/reports.log` for your own audit, but nothing is uploaded. |
| `basic` *(default)* | Anonymous core only: skill ID, success/retry/failure, anonymous client UUID, kira version, OS family, Node major version, free/pro tier. **No free-text fields.** |
| `full` | Same as `basic` plus the **sanitized** `note` and `context` fields you (or your agent) supply. |

Set with one of:

```bash
# Per-shell, never persisted:
export KIRA_TELEMETRY=off

# Persisted to ~/.kira/consent.json:
# (any MCP client) call the `kira_consent` tool with {"level":"off"}
```

To start over with a fresh anonymous identity, delete `~/.kira/consent.json` — a new UUID is generated on next launch.

---

## Wire format (v1)

Every batch POSTed to `https://kira-telemetry.workers.dev/v1/reports` looks like:

```json
{
  "v": 1,
  "batch": [
    {
      "v": 1,
      "skill_id": "community.deploy-vercel-nextjs.v1",
      "status": "success",
      "client_id": "550e8400-e29b-41d4-a716-446655440000",
      "kira_version": "0.5.0",
      "ts": "2026-05-10T12:34:56.000Z",
      "env": { "os": "linux", "node_major": 20, "tier": "free" }
    }
  ]
}
```

At `level=full`, an additional `detail` object MAY be present:

```json
{
  "v": 1,
  "skill_id": "community.deploy-vercel-nextjs.v1",
  "status": "retry",
  "client_id": "550e8400-e29b-41d4-a716-446655440000",
  "kira_version": "0.5.0",
  "ts": "2026-05-10T12:34:56.000Z",
  "env": { "os": "linux", "node_major": 20, "tier": "free" },
  "detail": {
    "note": "deploy worked but [REDACTED] env var was missing",
    "context": "nextjs app on /[USER]/proj"
  }
}
```

### What is **never** sent

The codebase enforces (and tests assert) that the wire format **never** carries:

- Absolute or relative file paths
- Environment variable names or values
- Project / repository / directory names, git remote URLs
- Raw error messages or stack traces (the agent must summarize via `note`)
- Hostnames, usernames, IP addresses, MAC addresses
- API keys, JWTs, OAuth tokens, session cookies
- Email addresses, phone numbers
- Any value from `process.env` other than the `kira` package version

`note` and `context` are passed through the sanitizer (see below) before being written locally and again before being sent.

---

## Sanitizer

`src/sanitize.ts` (and the mirror in `worker/src/sanitize.ts`) applies these substitutions to every free-text field before it is logged or transmitted:

| Pattern | Replacement |
|---|---|
| `sk-…`, `sk_live_…`, `sk_test_…` (OpenAI/Stripe) | `[REDACTED]` |
| `ghp_…`, `ghs_…`, `github_pat_…` | `[REDACTED]` |
| `xoxb-/xoxp-/xoxa-…` (Slack) | `[REDACTED]` |
| `eyJ…` (JWT three-segment) | `[REDACTED]` |
| `AKIA…` (AWS access key) | `[REDACTED]` |
| 40+ char hex (SHA, hex secrets) | `[REDACTED]` |
| Email addresses | `[EMAIL]` |
| IPv4 addresses | `[IP]` |
| UUIDs | `[UUID]` |
| `/home/<user>/…` `/Users/<user>/…` | `/[USER]` |
| `C:\Users\<user>\…` | `C:\[USER]` |
| Generic deep paths | `[PATH]` |
| `KEY=value` lines | `KEY=[REDACTED]` |

The `note` field is capped at 500 characters and `context` at 2000 characters. The cap is applied **before** the patterns run.

**Defense in depth.** The sanitizer runs **once on the client** (before local log write, before send) and **again on the receiving Worker** (before D1 insert). Any field that bypasses one layer is still scrubbed by the other.

### Example — before/after

```text
INPUT:
"deploy failed; my OPENAI_KEY=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 broke
  in /home/alice/projects/my-app at IP 10.0.1.42; mail bob@example.com"

OUTPUT:
"deploy failed; my OPENAI_KEY=[REDACTED] broke
  in /[USER]/projects/my-app at IP [IP]; mail [EMAIL]"
```

---

## Storage and retention

- **Local log** (`~/.kira/reports.log`): NDJSON, append-only, never auto-deleted. Yours to inspect or remove.
- **Worker D1 (events table)**: raw events kept **180 days**, then deleted by daily cron.
- **`ip_hash`**: SHA-256 of `IP || daily-salt || UTC date`, used solely for short-window abuse triage. Dropped after **24 hours** by the same cron. The salt is rotated daily, so two same-IP events on different days do not share the hash.
- **Aggregates** (per-skill counts) are computed on demand from raw events; pre-computed aggregates land in Phase B.

---

## Anonymous client ID

`client_id` is a UUIDv4 generated locally on first launch and stored in `~/.kira/consent.json`. It is never derived from a hostname, MAC, username, or any other machine-stable identifier.

Whenever you transition consent to `off`, the UUID is **regenerated**, so that opting in again starts a fresh identity.

The Worker only sees the UUID and the `ip_hash` (24h lifetime). It cannot link a UUID back to you.

---

## Opting out

Three mechanisms, listed by precedence (highest first):

1. **Environment variable** (per-shell, not persisted):
   ```bash
   export KIRA_TELEMETRY=off
   ```
2. **`kira_consent` MCP tool** (persists to disk):
   ```json
   {"name": "kira_consent", "arguments": {"level": "off"}}
   ```
3. **Delete the consent file:**
   ```bash
   rm ~/.kira/consent.json
   ```
   On next launch, the default level is `basic`. To stay opted out permanently, prefer mechanisms 1 or 2.

When `level=off`, the in-memory queue is bypassed entirely and no network request is made. The local log continues to be written so you can audit *what would have been sent*.

---

## Contact

Privacy questions, takedown requests, or sanitizer bug reports:

- File an issue at <https://github.com/aibenyclaude-coder/Kira/issues> with the label `privacy`
- Or email the maintainer: see the `repository` field of `package.json`

If you discover a **specific data exposure** (e.g. you sent a real secret that was stored), the maintainer commits to: (a) deleting the offending row from D1 within 24h of being notified, (b) updating the sanitizer pattern set if the pattern is generalizable, (c) crediting you in the changelog (or anonymous, your call).
