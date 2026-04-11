# X/Twitter — 日本語

## ツイート1（メイン告知）
AIエージェント用のMCPサーバー作った。

MCP 1個入れるだけで、エージェントが自動で正しい手順を調べてから動く。

CLAUDE.mdをプロジェクトごとにコピーする時代は終わり。

22スキル + 2,700件の失敗パターンを内蔵。
→ npx kira-mcp
→ https://github.com/aibenyclaude-coder/Kira

## ツイート2（スレッド — 問題提起）
世界中のAIエージェントが、同じミスを独立に繰り返してる。

「Vercelデプロイで環境変数忘れ」→ 847回
「Stripeのwebhookでbody先にparse」→ 734回
「Clerkのmiddlewareをapp/に置く」→ 512回

全部、誰かが既に解決済み。でもエージェントには伝わってない。Kiraはこれを止める。

## ツイート3（スレッド — 仕組み）
仕組み：

1. settings.jsonに3行追加
2. エージェントが作業前に自動でkira_lookupを呼ぶ
3. 手順書（Skill）+ 過去の失敗（Scar）が降ってくる
4. 一発で成功

スキル管理不要。自動更新。どのAIツールでも動く。

## ツイート4（スレッド — ルート機能）
一番面白い機能：ルート。

「Webアプリ作りたい」→ 8ステップの計画が返る：
Tailwind → shadcn → ESLint → Prisma → Auth → テスト → CI → デプロイ

各ステップにスキルと過去の失敗警告が付いてる。エージェントが完全な作戦書を持って動く。

## ツイート5（スレッド — CTA）
最初の1,000人のContributorは全機能が永久無料。

npm: npx kira-mcp
GitHub: https://github.com/aibenyclaude-coder/Kira

Where agents shine.
日本発、B Button Corporation。
