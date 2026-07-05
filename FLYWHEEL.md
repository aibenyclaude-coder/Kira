# Kira Flywheel — 改善ループの憲法

> 0→1 は創業者が出した。1→N はこのループが回す。(2026-07-06 制定)

## テーゼ

**Kira の中心価値は「個人の失敗が自動で資産になること」であり、community はその上に生える。**

- Skill (how-to) はモデルの進化と公式 docs に浸食される。**Scar (失敗知識) は浸食されない** — 訓練カットオフ以降の破壊的変更は永遠に供給されるから。
- community ネットワークはコールドスタート問題を抱える。**personal scar は n=1 で価値が出る**。コールドスタートが存在しない。
- したがって投資順序は: 供給の自動化 (F1) > 想起の自動化 (F2/F3) > 需要シグナル (miss log) > community 昇格 (F4) >>> routes / vendor 審査 / Pro tier (凍結)。

## 三つのループ

```
Loop A 供給:  失敗発生 → kira_record_failure (F1) → ~/.kira/personal-scars/
                → SessionStart で kira_personal_brief (F2) → 同じ失敗を回避 → hit_count 増加
Loop B 需要:  kira_lookup 0-hit → near-match 計算 → ~/.kira/misses.log (何が「惜しかった」かも記録)
                → flywheel が cluster → alias 追加 or 新規 skill/scar 候補
Loop C 品質:  kira_report (retry/failure + note) → ~/.kira/reports.log
                → flywheel が note を cluster → 反復する失敗 = scar 候補
```

集約器: `node dist/flywheel.js [--emit-candidates] [--llm claude-cli]`
- 決定的 (LLM なしで動く)。LLM は任意の磨き工程で、失敗したら常にスタブへフォールバック
- 出力: `~/.kira/flywheel/<date>-digest.md` + `candidates/*.json`
- candidates は**提案**であり自動公開しない。人間 (or レビュー付き agent) が skills/ へ昇格して PR

## 設計原則

1. **ミスは全部記録する** — 0-hit は失敗ではなく需要データ。near 情報付きで残す (「alias 不足」と「skill 不在」を区別するため)
2. **決定的コアと LLM 装飾を分離** — ループは `claude` CLI が無い環境でも完全に回る
3. **ローカル完結** — misses.log / personal-scars は決してネットワークに出ない。community 昇格 (F4) だけが明示的 opt-in + sanitize の出口
4. **証拠主義** — digest の全提案は「×N 回」「score X.XX」の実測値を引用する

## 凍結 (deprioritized until DAU exists)

- `kira_route`: 2026 年の LLM は静的 route 表より上手に計画する。削除はしないが投資しない
- vendor tier / Pro license / telemetry Phase B (HMAC) / Phase C (署名): ネットワーク段階の仕事
- README の narrative は「your agent stops repeating its own mistakes」へ寄せる (swarm #009 merge 後に別 PR)

## 運用 (この repo のメンテナ向け)

- 週次: `node dist/flywheel.js --emit-candidates` → digest を読む → candidates を採否 → 採用分を `add skill:` / `add scar:` PR
- systemd 例 (`CLAUDE_BIN` は絶対パスで — user unit は ~/.npm-global/bin を PATH に持たない):

```ini
[Service]
Type=oneshot
Environment=CLAUDE_BIN=%h/.npm-global/bin/claude
ExecStart=/usr/bin/node %h/Kira/dist/flywheel.js --emit-candidates
```

## 判断ログ

- 2026-07-06: Fable 5 セッションでの全コード評価に基づき制定。lookup の 0-hit 実測 (34 skills が web-dev 偏重でオーナー自身のタスクに当たらない) が直接の動機。miss log は repo 相対パスで実質故障していたため ~/.kira/ へ移設。
