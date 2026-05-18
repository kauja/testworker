# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**testworker** は Web アプリを自動巡回して console / network / errors / screenshot を収集し、画面遷移図として可視化する OSS。MIT ライセンス。

ユーザ向け説明・クイックスタートは `README.md` を参照（重複させない）。

## 🔒 振る舞いハーネス（必読）

**作業を始める前に [`AGENTS.md`](./AGENTS.md) を読むこと。** 自律で進めてよい範囲 / 確認が必要な範囲 / 公開禁止データ / PR 戦略がすべてそこにある。

- `main` は保護対象。**直接 push しない**。常に `feat/issue-<N>-<scope>` → PR → `auto-merge` ラベル。
- **作業中に対応が必要と感じたら、PR に混ぜず即 Issue 起票**（`gh issue create ...`）。詳細は AGENTS.md「Issue ドリブン開発」。
- `--amend` / `--no-verify` 禁止（こまめな commit + 履歴の追跡可能性を優先）
- `git add -A` / `git add .` 禁止（巻き込み事故防止）。明示的にファイル指定。
- テスト対象アプリ / `.env` / `storage-state` / HAR は **そもそも tree に置かない**。
- 意思決定の歴史的経緯は `docs/decisions/`（gitignore 済み、ローカル個人ログ）に保管。
- ハーネスで止められたら、抜け道を探さず方針を見直す（`.claude/settings.json` + `.claude/hooks/*` が物理ガード）。

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

## OSS / Contribution

- License: **MIT** (`./LICENSE`)
- 既存コードを真似する場合でも、外部から取り込んだコードは出典・ライセンスを必ず確認
- PR / Issue 文化は `CONTRIBUTING.md` 準拠

## Gotchas

- `host.docker.internal` はホストアプリ参照用。`extra_hosts` で Linux でも動く。
- `data/` は volume mount。`make clean-data` で run/db を一掃可能。スクリーンショットだけは `data/runs/` の手動削除。
- better-sqlite3 はネイティブビルドあり。コンテナ初回起動時に build-essential が必要 → `python3 make g++` を Dockerfile に入れている。
- React Flow v12 (`@xyflow/react`) を使用。v11 とインポートパスが違うので注意。
