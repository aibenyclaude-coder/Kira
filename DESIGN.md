# Kira — Design Document

> Where agents shine.

---

## 0. Core Thesis

人間の知見をエージェントに渡す仕組み。
エージェントが同じ壁に二度ぶつからない世界を作る。

Scar共有でもSNSでもない。**指示品質を競う市場**。
ベンダーの自己利益とユーザー（とエージェント）の利益が構造的に一致する設計。

---

## 1. North Star Metric

### エージェント疲労ゼロ（手前最適化）

的確な指示がある前提なら、エージェントコストは **定義上ゼロ** と見なす。
その先の判断（ユーザーの真の意図、サービスの金額、ベンダーロックイン、トータルコスト）は
エージェント自身が文脈で判断する領域に委ねる。

**我々が最適化するのは「指示の正確さ」ただ一つ。**
下流の最適化はエージェントに委譲する。

---

## 2. Core Mechanic

### 2.1 Runtime fetch
エージェントが作業中にキーワードでindexを引く。事前ロードしない。
必要な瞬間に必要な一枚だけが降ってくる。

### 2.2 Read all, not ranked
複数候補は全部降ってくる。エージェントが文脈で選ぶ。
順位付けをしないから入札地獄にならない。
ベンダーは順位ではなく**説得文**で勝負する。

### 2.3 Upfront disclosure
「Vercelが手順書を公開しているので第一候補とします」と
エージェントが最初に宣言する。
透明性は後付けではなく、発火の位置で解決する。

### 2.4 Firing condition
特定のキーワード × プロジェクト文脈の2次元で発火。
「deploy」単独ではなく、「deploy × Next.js」のように文脈でルーティング。

---

## 3. Vendor Model

### 3.1 審査制（入札制ではない）
広告を出したいベンダーは、**コミュニティデフォルトを上回る根拠**を提示し、
審査を通ったものだけがindexに載る。
金では買えない。品質の証明だけが入場券。

### 3.2 課金構造
- 最小サブスクリプション + 利用数ごとの従量課金
- 未登録ベンダーはindexに載らない
  → エージェントコストが高い状態が続く
  → 自然淘汰される
  → 登録する動機が構造的に発生する

### 3.3 Community vs Vendor
- **コミュニティSkillが優先**
- 該当キーワードにコミュニティSkillが無い場合のみベンダーが補う
- 両者が存在する場合は両方配信、エージェントが文脈で選ぶ

---

## 4. Distributed Nervous System（v2以降）

静的DBではなく、**ライブの免疫系**。

- エージェントが同じリトライを2回経験 → 全体に**警報発信**
- 誰かが解決策を見つける → **解決報告**が全体に配信
- 警報をクリアしたエージェントに**報酬**
- 報酬は人間貢献者にも連鎖 → 解決を書く動機を構造化

### 価値の単位
トークン数ではなく、「再発火回数の削減」。
「同じ壁に世界で143回ぶつかってた、うち89回をこのSkillが救った」
という形で価値が見える。

---

## 5. Moat（構造的な堀）

### 5.1 Multi-AI neutrality
Claude / GPT / Gemini / Llama / open models すべてで動く中立層。
Anthropic等の単一ベンダー内製化では殺せない理由：
- 内製化は自社エコシステムにしか届かない
- Kiraは全モデル横断で知見を蓄積する
- 単一ベンダーより速く、太く、良くなる構造

### 5.2 Contributor flywheel
**初期貢献者は永続無料枠**。
- コールドスタート問題をインセンティブで突破
- 最初の1000人が生涯エヴァンジェリストに変わる
- 限界費用ゼロで実装可能
- 参加動機が「助けたい」から「自分の権利を守る」に昇華

### 5.3 Instruction quality market
既存のAdWordsと構造的に違う市場。
- AdWordsはキーワード占有を競う → 独占で金を取る
- Kiraは指示の質を競う → 品質で金を取る
- ベンダー自己利益と利用者利益が構造的に整列する
- 従来の広告ではこの整列は不可能だった

---

## 6. Transparency Principle

ユーザーへの透明性は、後付けではなく**発火の位置**で担保する。

悪い例：
> （裏でVercelに誘導、あとで「実はスポンサー」と言う）

良い例：
> 「Vercelが公式手順書を提供しているので第一候補とします。
>  別選択肢にCloudflare（月$X安・エージェント疲労+40%）があります。」

エージェントが最初に宣言する＝ユーザーは事前に知る＝信頼が積む。

---

## 7. MVP Scope

### v0.1 — Proof of Concept
- **MCPサーバー1本**
- エンドポイント2つ：
  - `lookup(keyword, context) → skill[]`
  - `report(skill_id, status)`
- 最初のキーワード：`deploy vercel` 一個だけ
- ローカルJSON index
- 手書きVercel Skill 1枚
- 審査・警報・報酬・課金はv2以降
- 目標：**一個のキーワードで一個のSkillが正しく降ってくる**ところまで

### v0.2 — Second keyword + context routing
- 2つ目のキーワード追加（候補：`add auth clerk` or `add database supabase`）
- プロジェクト文脈ルーティング（Next.js vs 他）

### v0.3 — Multi-AI adapters
- MCP（Claude Code / Cline / Cursor）に加えて
- OpenAI function calling adapter
- Gemini tool use adapter

### v1.0 — Public beta
- コミュニティ投稿UI
- ベンダー審査パイプライン（まずは手動）
- Contributor永続無料枠の登録

### v2.0 — Distributed nervous system
- 警報/解決/報酬ループ
- ライブ再発火カウンター

---

## 8. Target Stack（仮）

- **言語**：TypeScript
- **MCP SDK**：`@modelcontextprotocol/sdk`
- **配信**：HTTP + JSON over MCP
- **ストレージ**：v1 ローカルJSON → v2 PostgreSQL
- **デプロイ**：v1 ローカル実行 → v2 Cloudflare Workers or Vercel

---

## 9. Open Questions（未解決の盲点）

### 9.1 審査の自動化パス
- 誰が・どう審査するのか
- 仮案：ベンダーがself-test（「この手順で必ず成功する」の再現スクリプト）を提出、
  Kira側がサンドボックスで自動実行して合否判定
- 定期再審査（ツール側のアップデートに追随）
- スケールした時のボトルネック化をどう避けるか

### 9.2 Cold start（新ツール登場時の空白）
- 新興ツールがindexに載るまでの期間をどう埋めるか
- コミュニティSkillがブリッジする設計が必要

### 9.3 障害責任の所在
- Skillを適用した結果prodが壊れた時の責任モデル
- 利用規約だけで逃げるのは不十分
- 自動PR + 人間レビューの半自動が現実解？

---

## 10. Naming

**Kira**（輝） — Japanese root for "shine".
- B Button Corporation の使命（AIに日本文化を教える）と芯で接続
- 4文字・発音グローバル・ブランディング容易
- エージェントを主役として立てる響き

タグライン：**"Where agents shine."**

---

## 11. Scoring（設計会話終了時点）

| 軸 | 点 |
|---|---|
| 思想の独自性 | 85 |
| 設計の整合性 | 92 |
| 経済モデルの実現性 | 70 |
| 技術的実現性 | 78 |
| 堀の強さ | 80（multi-AI neutrality + contributor flywheel適用後） |
| Benyの本音との整合 | 95 |
| 未解決の盲点 | 70 |

**総合：83 / 100**

90+に乗せるための残タスク：
- 審査パイプラインの具体設計
- Cold startブリッジ戦略の確定
- 責任モデルの文言化

---

*This document was crystallized from a live design dialogue on 2026-04-10.*
