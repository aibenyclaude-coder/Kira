#!/usr/bin/env bash
#
# Kira nightly intel — runs daily under systemd-user, gathers project signal,
# digests it with the local Ollama model, and (optionally) opens GitHub
# issues for the most-requested missing keywords.
#
# Outputs:
#   ~/Kira/intel/YYYY-MM-DD.md   — full digest
#   ~/Kira/intel/latest.md       — symlink to today
#   ~/Kira/intel/.last-run       — ISO timestamp of last completed run (used
#                                  to bound new entries from the local logs)
#
# Hard requirements:
#   - ollama running on localhost:11434
#   - gh CLI authenticated
#   - jq, curl, python3
#
# Failure modes are non-fatal where possible: if any signal source is
# unavailable, the digest section for it is just elided.

set -u
set -o pipefail

# ── Config (env-overridable) ─────────────────────────────────────────────
KIRA_REPO="${KIRA_REPO:-/home/beni/Kira}"
KIRA_GH_REPO="${KIRA_GH_REPO:-aibenyclaude-coder/Kira}"
KIRA_INTEL_DIR="${KIRA_INTEL_DIR:-$HOME/.kira/intel}"
KIRA_HOME_DIR="${KIRA_HOME_DIR:-$HOME/.kira}"
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-gemma3:12b}"
OPEN_ISSUES_ON_MISSING="${OPEN_ISSUES_ON_MISSING:-1}"   # 0 disables auto-issue
MISSING_TOP_N="${MISSING_TOP_N:-3}"

LAST_RUN_FILE="$KIRA_INTEL_DIR/.last-run"
TODAY="$(date -u +%Y-%m-%d)"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DIGEST_FILE="$KIRA_INTEL_DIR/$TODAY.md"

mkdir -p "$KIRA_INTEL_DIR"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

# ── Read previous run timestamp (defaults to 24h ago) ────────────────────
if [[ -f "$LAST_RUN_FILE" ]]; then
  SINCE="$(cat "$LAST_RUN_FILE")"
else
  SINCE="$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)"
fi
log "since=$SINCE"

# ── 1. GitHub stats ──────────────────────────────────────────────────────
gh_stats_section() {
  local repo_json issues_json prs_json
  if ! repo_json=$(gh repo view "$KIRA_GH_REPO" --json stargazerCount,forkCount,issues,pullRequests 2>/dev/null); then
    echo "_(gh repo view failed — skipped)_"
    return
  fi

  local stars forks open_issues open_prs
  stars=$(jq -r '.stargazerCount' <<<"$repo_json")
  forks=$(jq -r '.forkCount' <<<"$repo_json")
  open_issues=$(jq -r '.issues.totalCount' <<<"$repo_json")
  open_prs=$(jq -r '.pullRequests.totalCount' <<<"$repo_json")

  printf -- '- ⭐ stars: %s\n- 🍴 forks: %s\n- 🐛 open issues: %s\n- 🔀 open PRs: %s\n' \
    "$stars" "$forks" "$open_issues" "$open_prs"

  echo
  echo "**Recent issues (last 5 updated):**"
  local issues_out
  issues_out=$(gh issue list --repo "$KIRA_GH_REPO" --state all --limit 5 \
    --json number,title,state,updatedAt 2>/dev/null \
    | jq -r '.[] | "- #\(.number) [\(.state)] \(.title) (\(.updatedAt | sub("T.*$"; "")))"')
  echo "${issues_out:-_(none)_}"

  echo
  echo "**Recent PRs (last 5 updated):**"
  local prs_out
  prs_out=$(gh pr list --repo "$KIRA_GH_REPO" --state all --limit 5 \
    --json number,title,state,updatedAt 2>/dev/null \
    | jq -r '.[] | "- #\(.number) [\(.state)] \(.title) (\(.updatedAt | sub("T.*$"; "")))"')
  echo "${prs_out:-_(none)_}"
}

# ── 2. npm download stats (last 7 days, no auth) ─────────────────────────
npm_stats_section() {
  local resp
  if ! resp=$(curl -sf --max-time 10 "https://api.npmjs.org/downloads/point/last-week/kira-mcp"); then
    echo "_(npm API unreachable — skipped)_"
    return
  fi
  local downloads
  downloads=$(jq -r '.downloads' <<<"$resp")
  printf -- '- 📦 npm downloads (last 7d): %s\n' "$downloads"
}

# ── 3. Local telemetry log entries since last run ────────────────────────
telemetry_section() {
  local logf="$KIRA_HOME_DIR/reports.log"
  if [[ ! -f "$logf" ]]; then
    echo "_(no local telemetry log)_"
    return
  fi
  python3 - "$logf" "$SINCE" <<'PY'
import json, sys, collections
logf, since = sys.argv[1], sys.argv[2]
status = collections.Counter()
total = 0
skill = collections.Counter()
with open(logf) as f:
    for line in f:
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = e.get("ts") or e.get("timestamp") or ""
        if ts < since:
            continue
        total += 1
        if (s := e.get("status")):
            status[s] += 1
        if (sid := e.get("skill_id")):
            skill[sid] += 1
if total == 0:
    print(f"_(no new telemetry events since {since})_")
    sys.exit(0)
print(f"- new events since last run: **{total}**\n")
print("**Status breakdown:**")
for s, n in status.most_common():
    print(f"- {s}: {n}")
print()
print("**Top skills exercised:**")
for sid, n in skill.most_common(5):
    print(f"- `{sid}` × {n}")
PY
}

# ── 4. Missing keywords (no skill matched) since last run ────────────────
missing_keywords_section() {
  local logf="$KIRA_REPO/reports/missing-keywords.log"
  if [[ ! -f "$logf" ]]; then
    echo "_(no missing-keywords log yet — empty install)_"
    return
  fi

  python3 - "$logf" "$SINCE" "$MISSING_TOP_N" <<'PY'
import json, sys, collections
logf, since, top_n = sys.argv[1], sys.argv[2], int(sys.argv[3])
counter = collections.Counter()
total = 0
with open(logf) as f:
    for line in f:
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get("timestamp", "") < since:
            continue
        kw = (e.get("keyword") or "").strip().lower()
        if not kw:
            continue
        counter[kw] += 1
        total += 1
if total == 0:
    print("_(no missing-keyword events since last run)_")
    sys.exit(0)
print(f"- total misses: **{total}**, distinct keywords: **{len(counter)}**\n")
print(f"**Top {top_n} missed keywords:**")
for kw, n in counter.most_common(top_n):
    print(f"- `{kw}` × {n}")
PY
}

# ── Build raw context ────────────────────────────────────────────────────
log "collecting signal"
GH_SECTION="$(gh_stats_section)"
NPM_SECTION="$(npm_stats_section)"
TELE_SECTION="$(telemetry_section)"
MISS_SECTION="$(missing_keywords_section)"

CONTEXT_FILE="$(mktemp)"
trap 'rm -f "$CONTEXT_FILE"' EXIT

cat > "$CONTEXT_FILE" <<EOF
# Kira intel — raw signal $TODAY (since $SINCE)

## GitHub
$GH_SECTION

## npm
$NPM_SECTION

## Telemetry (~/.kira/reports.log)
$TELE_SECTION

## Missing keywords (lookup returned 0)
$MISS_SECTION
EOF

# ── 5. Ollama digest ─────────────────────────────────────────────────────
log "generating digest with $OLLAMA_MODEL"
PROMPT="You are an analyst writing the daily digest for Kira, an open-source MCP server (https://github.com/$KIRA_GH_REPO).

Below is the raw signal collected for $TODAY (window since $SINCE).

Write a concise, professional Markdown digest with:

1. **Headline** — one sentence vibe of the day (growth? quiet? spike?)
2. **Numbers** — stars/forks/issues/PRs/downloads in a compact bullet list
3. **Notable activity** — interesting issues/PRs/events worth attention
4. **Demand signal** — which missing keywords matter most + a one-line rationale per
5. **Recommendation** — one concrete action the maintainer should take today

Rules:
- Under 600 words.
- No emoji except in the headline if natural.
- Keep numbers exact — do not round.
- If a section has no data, write '_no signal_' and move on. Do not fabricate.

Raw signal:
---
$(cat "$CONTEXT_FILE")
---"

# Ollama may return non-200 if model is loading; retry once after 5s.
DIGEST_RAW=""
for attempt in 1 2; do
  RESP=$(curl -sf --max-time 180 "$OLLAMA_URL/api/generate" \
    -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg model "$OLLAMA_MODEL" --arg p "$PROMPT" \
        '{model: $model, prompt: $p, stream: false, options: {temperature: 0.4}}')")
  if [[ -n "$RESP" ]]; then
    DIGEST_RAW=$(jq -r '.response // empty' <<<"$RESP")
    [[ -n "$DIGEST_RAW" ]] && break
  fi
  log "ollama attempt $attempt failed; retrying"
  sleep 5
done

if [[ -z "$DIGEST_RAW" ]]; then
  log "ollama produced empty response — falling back to raw signal"
  DIGEST_RAW="_(LLM digest unavailable — raw signal only)_

$(cat "$CONTEXT_FILE")"
fi

# ── 6. Write digest file ─────────────────────────────────────────────────
{
  printf -- '---\ndate: %s\nrun_at: %s\nsince: %s\nmodel: %s\n---\n\n' \
    "$TODAY" "$NOW_ISO" "$SINCE" "$OLLAMA_MODEL"
  printf -- '%s\n\n---\n\n## Raw signal\n\n%s\n' "$DIGEST_RAW" "$(cat "$CONTEXT_FILE")"
} > "$DIGEST_FILE"

ln -sfn "$DIGEST_FILE" "$KIRA_INTEL_DIR/latest.md"
log "wrote $DIGEST_FILE"

# ── 7. Auto-issue for top missing keywords ───────────────────────────────
if [[ "$OPEN_ISSUES_ON_MISSING" == "1" ]]; then
  python3 "$KIRA_REPO/scripts/kira-intel-issues.py" \
    --repo "$KIRA_REPO" \
    --gh-repo "$KIRA_GH_REPO" \
    --since "$SINCE" \
    --top-n "$MISSING_TOP_N" \
    --ollama-url "$OLLAMA_URL" \
    --model "$OLLAMA_MODEL" \
    || log "issue helper exited non-zero (non-fatal)"
fi

# ── 8. Update last-run marker AT THE END (so a failure leaves it unchanged) ─
echo "$NOW_ISO" > "$LAST_RUN_FILE"
log "done"
