# Render: vhs demo.tape  (needs: vhs, ttyd, ffmpeg — https://github.com/charmbracelet/vhs)
Output demo.gif

Set FontSize 14
Set Width 900
Set Height 520
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 20

Type "# Monday — the agent burns itself"
Enter
Sleep 500ms

Type "echo 'gate: npm run build 2>&1 | tail -1   # exit code comes from tail!'"
Enter
Sleep 300ms

Type "echo '✗ broken code reached main (compiler failed, gate passed)'"
Enter
Sleep 600ms

Type@0ms "echo '>>> kira_record_failure(title: build gate bypassed: pipe swallowed exit code)'"
Enter
Sleep 300ms

Type "echo '  ✓ personal scar saved — local-only, never uploaded'"
Enter
Sleep 1s

Type ""
Enter

Type "# Tuesday — new session, same machine"
Enter
Sleep 500ms

Type@0ms "echo '── session brief ─────────────────────────────'"
Enter
Sleep 200ms

Type "echo '⚠ You have been burned by this before:'"
Enter
Sleep 200ms

Type "echo '  build gate bypassed: exit code swallowed by pipe to tail'"
Enter
Sleep 200ms

Type "echo '  → never gate on a piped command without set -o pipefail'"
Enter
Sleep 700ms

Type "echo ''"
Enter

Type "echo '✓ agent writes: set -o pipefail; npm run build'"
Enter
Sleep 200ms

Type "echo '✓ zero repeats. zero wasted tokens.'"
Enter
Sleep 1s

Type ""
Enter
Type "echo '(real scar #1 — recorded by the agent that built this feature)'"
Enter
Sleep 500ms

Type "echo 'Install: npx kira-mcp'"
Enter
Type "echo 'Where agents shine — by remembering where they got burned.'"
Enter

Sleep 3s
