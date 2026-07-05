#!/usr/bin/env bash
#
# Kira — Claude Code SessionStart hook.
#
# The "magic moment": at the start of every session, surface the PERSONAL scars
# you hit last time on this machine (the private, local-only failure notes
# recorded by kira_record_failure), so the agent begins already aware of the
# walls it ran into before.
#
# It drives the Kira MCP server over stdio — the same newline-delimited JSON-RPC
# exchange documented in examples/README.md — calls the `kira_personal_brief`
# tool, formats the top-N recent scars, and hands them back to Claude Code as
# SessionStart context via the hook JSON contract.
#
# ── Wiring ──────────────────────────────────────────────────────────────────
# Add to ~/.claude/settings.json (global) or .claude/settings.json (project):
#
#   {
#     "hooks": {
#       "SessionStart": [
#         {
#           "hooks": [
#             {
#               "type": "command",
#               "command": "bash /ABSOLUTE/PATH/TO/examples/claude-code-sessionstart-hook.sh"
#             }
#           ]
#         }
#       ]
#     }
#   }
#
# ── Options (environment variables) ─────────────────────────────────────────
#   KIRA_BRIEF_LIMIT   How many recent scars to surface (default: 5).
#   KIRA_MCP_CMD       Command that launches the Kira MCP server
#                      (default: "npx kira-mcp"; e.g. "node dist/index.js").
#
# ── Requirements ────────────────────────────────────────────────────────────
#   node/npx (to run the Kira server) and jq. If anything is missing — or the
#   server errors, or no scars exist yet — the hook exits 0 and emits nothing.
#   It must NEVER block a session from starting.

set -uo pipefail

LIMIT="${KIRA_BRIEF_LIMIT:-5}"
KIRA_MCP_CMD="${KIRA_MCP_CMD:-npx kira-mcp}"

# Sanitize the limit: fall back to the default unless it is a plain integer.
case "$LIMIT" in
  '' | *[!0-9]*) LIMIT=5 ;;
esac

# Never block session start: if a required tool is absent, do nothing.
command -v jq >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || command -v npx >/dev/null 2>&1 || exit 0

# Drain (and ignore) the hook's stdin JSON so the pipe never stalls.
cat >/dev/null 2>&1 || true

# Backstop so a wedged server can't hang session startup (normally returns <1s).
timeout_cmd=""
command -v timeout >/dev/null 2>&1 && timeout_cmd="timeout 15"

# 1. Drive the server: initialize -> initialized -> tools/call kira_personal_brief.
#    The Kira server exits when stdin closes, so the trailing `sleep` is only to
#    give it a beat to answer before EOF. $KIRA_MCP_CMD is intentionally word-split
#    into "command arg" (e.g. npx kira-mcp).
# shellcheck disable=SC2086
raw="$(
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"kira-sessionstart-hook","version":"1.0"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"kira_personal_brief","arguments":{"limit":%s}}}\n' "$LIMIT"
    sleep 0.5
  } | $timeout_cmd $KIRA_MCP_CMD 2>/dev/null
)" || exit 0

# 2. Pull the tool result: the JSON-RPC line with id==2, whose
#    result.content[0].text is itself the (stringified) PersonalBrief JSON.
#    -R + fromjson? tolerates any non-JSON noise lines without aborting;
#    `fromjson | tojson` re-compacts the (pretty-printed) payload onto one line
#    so the head -n1 guard can't truncate it mid-object.
brief="$(printf '%s\n' "$raw" \
  | jq -Rr 'fromjson? | select(.id == 2) | .result.content[0].text | fromjson | tojson' 2>/dev/null \
  | head -n1)"

# No response / tool error / malformed -> stay silent.
[ -n "$brief" ] && [ "$brief" != "null" ] || exit 0

# 3. Format a compact banner from the PersonalBrief object.
text="$(printf '%s' "$brief" | jq -r '
  ( .scars // [] ) as $scars
  | if ($scars | length) == 0 then empty
    else
      ( [ "🔴 Kira personal brief — recent failures on this machine:",
          ( .headline // "" ) ]
        + ( $scars
            | to_entries
            | map(
                "\(.key + 1). [\(.value.severity)] \(.value.title)"
                + ( if (.value.instead // "") != ""
                    then "\n   ↳ instead: \(.value.instead)" else "" end )
                + ( if (.value.hit_count // 0) > 1
                    then "  (hit \(.value.hit_count)×)" else "" end )
              )
          )
      )
      | join("\n")
    end
' 2>/dev/null)" || exit 0

# Nothing worth surfacing (e.g. clean slate) -> emit nothing.
[ -n "$text" ] || exit 0

# 4. Hand the brief to Claude Code as SessionStart context. jq -Rs safely
#    escapes the multi-line text into a JSON string.
printf '%s' "$text" \
  | jq -Rs '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: .}}'

exit 0
