# Kira maintainer scripts

Operational scripts run by the project maintainer. Not shipped in the npm package.

## `kira-intel.sh` — nightly intel digest

Collects daily signal (GitHub stats, npm downloads, local telemetry, missing keywords) and uses a local Ollama model to write a Markdown digest.

**Outputs:**

- `~/Kira/intel/YYYY-MM-DD.md` — full digest with raw signal appended
- `~/Kira/intel/latest.md` — symlink to today's digest
- `~/Kira/intel/.last-run` — ISO timestamp; the next run only counts events newer than this

**Auto-issues** (controlled by `OPEN_ISSUES_ON_MISSING=1`, default on):
opens a `needs-skill`-labeled GitHub issue for each of the top-N keywords that returned 0 results from `kira_lookup`. Idempotent — skips a keyword whose substring already appears in any open issue title.

### Run manually

```bash
OPEN_ISSUES_ON_MISSING=0 ./scripts/kira-intel.sh   # dry run, no GitHub writes
./scripts/kira-intel.sh                             # full run
```

### Schedule with systemd-user

`~/.config/systemd/user/kira-intel.service`:

```ini
[Unit]
Description=Kira nightly intel digest
Wants=network-online.target
After=network-online.target ollama.service

[Service]
Type=oneshot
WorkingDirectory=%h/Kira
ExecStart=%h/Kira/scripts/kira-intel.sh
TimeoutStartSec=15min
Nice=10
```

`~/.config/systemd/user/kira-intel.timer`:

```ini
[Unit]
Description=Daily 09:00 — Kira intel digest

[Timer]
OnCalendar=*-*-* 09:00:00
Persistent=true
RandomizedDelaySec=300
Unit=kira-intel.service

[Install]
WantedBy=timers.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now kira-intel.timer
systemctl --user list-timers kira-intel.timer
journalctl --user -u kira-intel -e   # tail recent runs
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `KIRA_REPO` | `/home/beni/Kira` | Local repo path (where `reports/missing-keywords.log` lives) |
| `KIRA_GH_REPO` | `aibenyclaude-coder/Kira` | `owner/repo` for `gh` calls |
| `KIRA_INTEL_DIR` | `$HOME/Kira/intel` | Where digests are written |
| `KIRA_HOME_DIR` | `$HOME/.kira` | Where `reports.log` lives |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_MODEL` | `gemma3:12b` | Model name |
| `OPEN_ISSUES_ON_MISSING` | `1` | Set to `0` to skip auto-issue creation |
| `MISSING_TOP_N` | `3` | How many missing keywords to surface and (when enabled) open issues for |

### Required tools

`bash`, `jq`, `python3`, `curl`, `gh` (authenticated), `ollama` (running with at least one model pulled).
