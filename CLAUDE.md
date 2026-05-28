# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**testworker** は Web アプリを自動巡回して console / network / errors / screenshot を収集し、画面遷移図として可視化する OSS。MIT ライセンス。

ユーザ向け説明・クイックスタートは `README.md` を参照（重複させない）。

## ⚡ 最重要ルール — 自律実行（進路確認しない）

オーナーは作業中の進路確認を望まない。**Issue 起票・PR 作成・merge までを自己判断で進める**。優先度 (p0 → p1 → p2) 順に自律完遂し、完了時または重要な区切りで「報告」のみ行う（質問ではなく報告）。

### 例外（事前確認してよいケース）

1. **破壊的・不可逆な操作** — main への force push、リポジトリ削除、`gh api ... DELETE`、データの一括削除など
2. **ユーザ固有の情報が必要** — 個人の好み、アクセス権限、認証情報など、技術的根拠だけでは決められないもの
3. **仕様の根本的な不確定** — 要件が複数解釈可能で、コード・Issue・既存資料を読んでも判断材料が無いもの

それ以外（PR 戦略の選択、Issue の順序、リファクタ範囲、命名、ライブラリ選定など）は**自分で判断して進める**。

## 🔒 振る舞いハーネス（必読）

**作業を始める前に [`AGENTS.md`](./AGENTS.md) を読むこと。** 自律で進めてよい範囲 / 確認が必要な範囲 / 公開禁止データ / PR 戦略がすべてそこにある。

- `main` は保護対象。**直接 push しない**。常に `feat/issue-<N>-<scope>` → PR → `auto-merge` ラベル。
- **作業中に対応が必要と感じたら、PR に混ぜず即 Issue 起票**（`gh issue create ...`）。詳細は AGENTS.md「Issue ドリブン開発」。
- `--amend` / `--no-verify` 禁止（こまめな commit + 履歴の追跡可能性を優先）
- `git add -A` / `git add .` 禁止（巻き込み事故防止）。明示的にファイル指定。
- テスト対象アプリ / `.env` / `storage-state` / HAR は **そもそも tree に置かない**。
- 意思決定の歴史的経緯は `docs/decisions/`（gitignore 済み、ローカル個人ログ）に保管。
- ハーネスで止められたら、抜け道を探さず方針を見直す（`.claude/settings.json` + `.claude/hooks/*` が物理ガード）。

## Workflow Rules

- **AI-DLC（Intent → Bolt）**: 大きい product goal は `type:intent` の Outcome 言語化、その下に 1-2 週で動かす `type:bolt` をぶら下げて Bolt 単位で PR 化する。「次にやること」は `type:intent` + `stage:active` の配下の Bolt から拾う。詳細は [AGENTS.md「AI-DLC: Intent → Bolt の運用」](./AGENTS.md#ai-dlc-intent--bolt-の運用必読)
- **multi-round refactor / 連続 PR**: 1 PR ずつ CI green を確認してから次 PR を開く。連続 push で main を不安定化させない（必要なら手元で `git fetch origin main && git merge origin/main` で追従してから新 PR）
- **parallel worker subagent**: 並列度は cap（default 2、最大 3）。fan-out 前に対象スコープ（service / package / file 群）の **完全な一覧** をユーザに提示・確認してから起動する（漏れて後追い再実行を避ける）。**書き込みを伴う並列 worker は必ず worktree で隔離する**（下記）
- **worktree 隔離（並列開発の必須要件）**: 2 つ以上のエージェント / タスクが同時にファイルを編集するときは、各 worker を独立した git worktree で動かす。
  - `Agent` tool で起動する書き込み系 subagent は `isolation: "worktree"` を**必ず**指定（読み取りのみの `Explore` 等は省略可）
  - 手元での並列ブランチ作業は `git worktree add ../testworker-<scope> <branch>` で別ディレクトリに切り出す
  - 5 件以上の fan-out は `python scripts/orchestrate.py run <plan>.yaml` 経由（`.orchestrate/worktrees/<id>/` で自動隔離）
  - 完了したら `git worktree remove <path>` / `orchestrate.py cleanup` で必ず片付ける
  - 詳細・禁止事項・例外は [AGENTS.md「並列開発は worktree で隔離する」](./AGENTS.md#並列開発は-worktree-で隔離する必須) を参照
- **rate-limit 検知**: worker が API rate-limit に当たったら、当該 worker は backoff（30s → 60s → 120s 指数）、checkpoint を保存してから再開。supervisor は失敗 worker を 1 回まで再起動し、2 回目以降は人間に通知
- **batch commit**: 関連する変更は 1 commit に束ね、commit message に「何を / なぜ」を書く。`--amend` 禁止、新規 commit を積む

## Architecture（読まないと迷う部分のみ）

pnpm workspaces のモノレポ。データは SQLite + ローカルファイル。3 プロセス構成。

- `packages/shared` — Zod スキーマと型。**他パッケージはここから型を取る**。新しいフィールドは必ず `schema.ts` を起点に追加。
- `packages/runner` — Playwright クローラー。CLI で 1 ショット実行。SQLite に**書き込み専用**。
- `packages/api` — Hono。SQLite を**読み取り中心**で配信。`/assets/*` で `DATA_DIR` 配下を静的配信（パストラバーサル防止チェック必須）。
- `packages/web` — Next.js 15 App Router + React Flow。Server Component が `api` を fetch、ノード詳細は Client で fetch。

データの流れ:

```
runner → SQLite + ./data/runs/*    ← api reads
                                      ↑
                                    web (Server Component fetch → Client for drilldown)
```

### SPA の画面状態識別（重要）

`packages/runner/src/crawl/signature.ts` で URL + DOM 構造ハッシュから `signature` を生成。**同じ URL でも DOM 構造が違えば別ノード扱い**。

- 動的テキストでハッシュが乱れないよう、**安定属性 (id / data-testid / role / aria-label / name) + タグ階層** のみから計算
- ランドマーク要素 (`header`, `nav`, `main`, `footer`, `aside`, `[role=main]`, `[role=navigation]`) のみを対象に深さ 6 で打ち切り
- 同一 run 内で `(run_id, signature)` がユニーク制約 — 同じ画面に再到達してもページは増えない、エッジだけ増える

新しい属性を「安定」と定義したい場合は `STABLE_ATTRS` を編集する。

### Database schema

`packages/runner/src/db/migrate.ts` の `DDL` 定数が**正本**。drizzle ORM は採用していない（raw SQL + better-sqlite3）。マイグレーションは現状追記専用で、ALTER 系を入れる場合はバージョン管理の仕組みを足す必要あり。

主要テーブル:

- `runs` — クロール 1 回分のメタ
- `page_states` — 1 つの画面状態。`(run_id, signature)` UNIQUE
- `edges` — 画面遷移。`(run_id, from, to, trigger, selector)` UNIQUE
- `console_entries` / `network_entries` / `page_errors` — 各ページにぶら下がるイベント

### 認証

2 つのモードを `CrawlOptions` でサポート:

1. **storageState** — 事前生成した `storage-state.json` のパスを渡す。永続セッションがある場合の最速ルート。
2. **loginScript** — `default export` で `({ page, context }) => Promise<void>` を返す TS ファイル。`packages/runner/src/auth/login.ts` の `loadLoginScript` が動的 import。秘密情報は環境変数経由で渡すこと（リポジトリにコミットしない）。

## Commands

```bash
make up                              # docker compose で web + api 起動
make migrate                         # SQLite スキーマ初期化
make crawl URL=http://host.docker.internal:3000
make logs / make down / make clean-data

# ホスト Node を使う場合
pnpm install
pnpm --filter @testworker/runner run crawl -- --url <url>
pnpm --filter @testworker/api  run dev
pnpm --filter @testworker/web  run dev

pnpm -r run typecheck                # 全パッケージ型チェック
```

## Conventions

- Node 22 / TypeScript strict / `noUncheckedIndexedAccess` / `verbatimModuleSyntax`
- ESM only (`"type": "module"`)
- 型は `@testworker/shared` を import、新規エンティティは Zod schema 経由で導入
- runner は副作用 (DB / FS / Browser) の境界を `crawl/` 配下に集約、`db/repo.ts` 以外で `db.$sqlite.prepare` を呼ばない
- web は dark theme 固定（`globals.css` で `color-scheme: dark`）、アクセントカラーは `accent` (#7c9cff)、エラーは `bad` (#ff7a8a)
- スクリーンショット URL は必ず `assetUrl(page.screenshotPath)` 経由で生成（生成ロジックを 1 箇所に集約）

## Code Style Conventions

- **module-level 定数を先頭で宣言**: スタイル定数 / config 値 / base URL / 正規表現などは file 先頭（import 直後）でまとめて宣言し、関数本体で参照する。「使う前に宣言」を徹底（lint 由来の cascade 修正を避ける）
- **レイヤ越境の事前確認**: 関数を別レイヤ（handlers ↔ middleware、runner ↔ api、shared ↔ 各 package）に移す前に、import 方向と依存グラフを確認する（package.json / tsconfig path / 既存 import）。逆方向依存を作らない
- **noqa / eslint-disable は最終物理行に**: 複数行に跨る式（Python の multi-line f-string、TypeScript の chained call）に lint 抑制コメントを付ける場合、**最終物理行**に置く（中間行に置くと無視される）
- **TypeScript**: `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` 前提。`any` 禁止（やむを得ない場合は `unknown` + narrow）
- **エラー処理**: throw する場合は型情報を残し、catch 側で `instanceof Error` で narrow

## Testing & Validation

**「done」と言う前に必ず通すゲート**（自動 hook で stop-quality-check.mjs が typecheck を流すが、それだけでは不十分）:

- `pnpm -r run typecheck` — 4 package すべて緑
- `pnpm exec prettier --check .` — フォーマット完走（差分なし）
- 変更があった package の test（追加していれば）
- **Python を持つツール群**（将来 `scripts/orchestrate.py` 等）: `ruff check` / `mypy` が 0 件、必要なら `pytest`
- multi-file 変更 / refactor の後は **全 suite を回す**（type / format / test）。1 file 変更でも、import 元が他 package にあれば波及するので `-r` を必ず付ける

セルフチェック手順:

```bash
pnpm -r run typecheck && pnpm exec prettier --check . && echo OK
```

CI が失敗した場合、必ずローカルで再現してから fix を push する（盲打ち禁止）。

## OSS / Contribution

- License: **MIT** (`./LICENSE`)
- 既存コードを真似する場合でも、外部から取り込んだコードは出典・ライセンスを必ず確認
- PR / Issue 文化は `CONTRIBUTING.md` 準拠

## Gotchas

- `host.docker.internal` はホストアプリ参照用。`extra_hosts` で Linux でも動く。
- `data/` は volume mount。`make clean-data` で run/db を一掃可能。スクリーンショットだけは `data/runs/` の手動削除。
- better-sqlite3 はネイティブビルドあり。コンテナ初回起動時に build-essential が必要 → `python3 make g++` を Dockerfile に入れている。
- React Flow v12 (`@xyflow/react`) を使用。v11 とインポートパスが違うので注意。
