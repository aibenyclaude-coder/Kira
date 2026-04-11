Output demo.gif

Set FontSize 14
Set Width 900
Set Height 500
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 20

Type "# Without Kira: agent deploys and forgets env vars"
Enter
Sleep 500ms

Type "echo 'Deploying to Vercel...'"
Enter
Sleep 300ms

Type "echo '✓ Build succeeded'"
Enter
Sleep 300ms

Type "echo '✗ App crashed: Missing STRIPE_SECRET_KEY'"
Enter
Sleep 300ms

Type "echo '✗ Retry 1... same error'"
Enter
Sleep 300ms

Type "echo '✗ Retry 2... same error'"
Enter
Sleep 1s

Type ""
Enter

Type "# With Kira: agent looks up skills + scars first"
Enter
Sleep 500ms

Type@0ms "echo '>>> kira_lookup(deploy vercel, [nextjs])'"
Enter
Sleep 300ms

Type "echo ''"
Enter

Type "echo '  SKILL: Deploy a Next.js project to Vercel'"
Enter
Sleep 200ms

Type "echo '  Step 4: Run vercel env ls — check ALL env vars'"
Enter
Sleep 200ms

Type "echo ''"
Enter

Type "echo '  ⚠ SCAR [critical] (847 hits):'"
Enter
Sleep 200ms

Type "echo '  Vercel deploy succeeds but app crashes — missing env vars'"
Enter
Sleep 200ms

Type "echo '  → Run vercel env ls BEFORE deploying'"
Enter
Sleep 500ms

Type "echo ''"
Enter

Type "echo '✓ Agent checks env vars first'"
Enter
Sleep 200ms

Type "echo '✓ Deploys correctly on first try'"
Enter
Sleep 200ms

Type "echo '✓ Zero retries. Zero wasted tokens.'"
Enter
Sleep 1.5s

Type ""
Enter
Type "echo 'Install: npx kira-mcp'"
Enter
Type "echo 'Where agents shine.'"
Enter

Sleep 3s
