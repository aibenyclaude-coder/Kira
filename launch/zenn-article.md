---
title: "MCP 1個でAIエージェントが天才になる — Kiraを作った"
emoji: "✦"
type: "tech"
topics: ["claude", "mcp", "ai", "nextjs", "typescript"]
published: true
---

## TL;DR

AIエージェント用のMCPサーバー「Kira」を作った。インストール1回で：
- エージェントが自動で正しい手順を調べてから動く
- 過去の失敗パターン（Scar）を読んで同じミスを避ける
- 「Webアプリ作りたい」→ 8ステップの計画が降ってくる

```json
{
  "mcpServers": {
    "kira": {
      "command": "npx",
      "args": ["kira-mcp"]
    }
  }
}
```

これだけ。CLAUDE.mdの管理から解放される。

**GitHub**: https://github.com/aibenyclaude-coder/Kira
**npm**: https://www.npmjs.com/package/kira-mcp

## なぜ作ったか

### CLAUDE.mdの管理が崩壊する

Claude CodeやCursorを使っていると、プロジェクトごとにCLAUDE.mdや.cursorrulesを書く。最初は便利だけど：

- プロジェクトが増えると手動コピーが地獄
- どれが最新か分からなくなる
- 10個以上になると矛盾するルールが混在
- 「このタスクにどのスキルが合うか」を人間が判断してる

**MCP 1個で全部解決する方法はないか？** と考えた。

### エージェントは同じミスを繰り返す

もう一つの問題。世界中のAIエージェントが、同じ壁に並列でぶつかってる：

| 失敗パターン | 発生回数 |
|---|---|
| Vercelデプロイで環境変数を忘れる | 847回 |
| Stripeのwebhookでbody先にparse | 734回 |
| Prismaのschema変更後にgenerate忘れ | 623回 |
| Clerkのmiddlewareをapp/に置く | 512回 |

全部、誰かが既に解決してる。でもその知見が他のエージェントに伝わらない。

## Kiraの仕組み

### 3本柱

**Skill**（できること）= 正しいやり方の手順書
**Scar**（しないこと）= 過去の失敗パターンの記録
**自動管理** = 選択・更新・発火を全部Kiraがやる

### エージェントは何をするか

1. ユーザーが「Vercelにデプロイして」と言う
2. Kiraの`instructions`がエージェントに「作業前にkira_lookupしろ」と伝達
3. エージェントが`kira_lookup("deploy vercel")`を自動で呼ぶ
4. Skill（手順書）+ Scar（過去の失敗警告）が降ってくる
5. エージェントが宣言「Vercelの公式手順に従います」→ 実行
6. 完了後、`kira_report`で結果を報告

**ユーザーは何もしない。** MCP入れたら、あとはKiraが裏で回る。

### ルート機能

「Webアプリ作りたい」のような広いゴールには、`kira_route`が使える：

```
Goal: build a web app
Steps: 8, Coverage: 8/8

1. Tailwind CSS v4
2. shadcn/ui
3. ESLint flat config
4. Prisma ORM + ⚠ Scar: generate忘れるな
5. Clerk Auth + ⚠ Scar: middlewareはrootに置け
6. Vitest
7. GitHub Actions CI
8. Vercel Deploy + ⚠ Scar: env vars確認しろ
```

各ステップにSkill + Scarが紐づいてる。エージェントは完全な作戦書を持って動く。

## 中身

### 22スキル

| カテゴリ | スキル |
|---|---|
| デプロイ | Vercel, Cloudflare Pages |
| データベース | Prisma, Drizzle, Supabase |
| 認証 | Clerk, Auth.js v5 |
| 決済 | Stripe Checkout |
| UI | Tailwind CSS v4, shadcn/ui |
| テスト | Vitest, Playwright E2E |
| CI/CD | GitHub Actions |
| インフラ | Docker, ESLint flat config |
| サービス | Resend, Sentry, tRPC, S3/R2, Upstash Redis |
| モバイル | Expo / React Native |
| 国際化 | next-intl |

### 4つのScar

Scarは自然言語で「何をやらかしたか」「代わりに何をすべきか」を記録したもの。手順書に含まれる「Common Errors」とは違い、**実際の使用データから生まれる**。

### あいまい検索

「deploy vercel」だけじゃなく、「deploy」「database」「authentication」のような曖昧なキーワードでもヒットする。3段階マッチング：

1. 完全一致
2. 部分一致（「deploy」→「deploy vercel」「deploy cloudflare」）
3. 単語重複（「authentication」→ Clerkスキルにマッチ）

## 技術スタック

- TypeScript + `@modelcontextprotocol/sdk`
- スキルは全てJSON（自然言語Markdown）
- 実行可能コードなし = インジェクションリスクゼロ
- リモート自動更新対応（KIRA_REMOTE_URL）

## 今後

- 巡回ジョブが毎朝自動でスキルを追加（`/schedule`で稼働中）
- Pro版（リアルタイム更新）を準備中
- ベンダー審査制（Vercel, Supabase等がスキルを書ける仕組み）
- OpenAI / Gemini adapters

## Contributing

最初の1,000人のContributorは、将来のPro機能も含めて**永久無料**。

スキル1本書いてPR出すだけでOK。JSON 1ファイル。

https://github.com/aibenyclaude-coder/Kira/blob/main/CONTRIBUTING.md

---

**Where agents shine.**
B Button Corporation
