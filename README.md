# testworker

[![CI](https://github.com/kauja/testworker/actions/workflows/ci.yml/badge.svg)](https://github.com/kauja/testworker/actions/workflows/ci.yml)
[![secret-scan](https://github.com/kauja/testworker/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/kauja/testworker/actions/workflows/secret-scan.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22-brightgreen.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> Web アプリを自動巡回し、コンソール・ネットワーク・エラーを収集して、画面遷移図として可視化する OSS。

**testworker** はローカルあるいはステージングの Web アプリを Playwright で自動巡回し、各画面の **コンソールログ・ネットワーク・JS エラー・スクリーンショット** を収集して、**画面遷移図** として可視化する OSS ツールです。日本語 UI 中心で、個人開発者や小規模チームの「自分のアプリの全体像を一目で把握したい」というニーズに応えます。SPA も「URL + DOM 構造ハッシュ」で別状態として識別します。

> 📸 **Screenshots / Demo GIF**: `docs/images/runs-list.png`, `docs/images/graph-view.png`, `docs/images/demo.gif` を配置すると下の Quick start 上に展開されます (Issue #105)。 binary は最小化して `docs/images/README.md` に出典明記。

- 🕸 BFS クロールで自動巡回（同一オリジン / 深さ / ページ数で制御）
- 📸 ページごとにスクリーンショット
- 🔎 コンソール / ネットワーク / pageerror / unhandledrejection を記録
- 🔐 `storageState` または `loginScript` で認証付きサイトに対応
- 🗺 React Flow ベースの遷移図 UI でドリルダウン
- 🐳 すべて Docker Compose で完結（ホストに Node 不要）

License: **MIT**

---

## Quick start — 30 秒で動く例 (Intent #128)

```bash
# 1. clone & 起動 (web: http://localhost:3000 / api: http://localhost:3001)
git clone https://github.com/kauja/testworker.git && cd testworker && make up

# 2. (別シェル) 公開サイトを 1 本クロール — 認証不要・設定不要
make crawl URL=https://example.com

# 3. ブラウザで結果を開く
open http://localhost:3000
```

これで `make up` (= `docker compose up --build`) が **migrate (SQLite 初期化) → api → web** を一連で起動し、 `make crawl` で 1 ページぶん (`example.com` は 1 ページのみ) のスクリーンショット・コンソール・ネットワークを記録、 ブラウザで遷移図 UI を確認できます。 ここまで通常 **30 秒〜1 分**。 `make migrate` を別途叩く必要はありません (#151)。

### 自分のアプリで試す

```bash
# Docker 内から host を見る URL を渡す (macOS / Win)
make crawl URL=http://host.docker.internal:3000

# Linux でも extra_hosts: host-gateway 設定済みなので同じ URL で OK
```

認証付きサイト / 大規模 SPA / 失敗時の対処は [`docs/troubleshooting.md`](./docs/troubleshooting.md) に 5 章 (origin / login / timeout / robots / certificate) を集約しています。 framework preset は [`docs/presets/`](./docs/presets/) を参照。

---

## アーキテクチャ

```
┌────────────┐    crawl    ┌────────────────────────┐
│  runner    │ ─────────▶  │  Playwright (Chromium) │
│ (Node+TS)  │             └────────────────────────┘
│            │
│            │── writes ──▶  data/db/testworker.sqlite
│            │── writes ──▶  data/runs/<runId>/screenshots/*.png
└────────────┘

       ▲
       │ reads
┌────────────┐                ┌────────────┐
│   api      │  HTTP/JSON  ─▶ │   web      │
│  (Hono)    │                │ (Next.js + │
│            │                │ React Flow)│
└────────────┘                └────────────┘
```

| パッケージ        | 説明                                                    |
| ----------------- | ------------------------------------------------------- |
| `packages/shared` | Zod スキーマ・型定義（全体で共有）                      |
| `packages/runner` | Playwright クロール本体・SQLite 書き込み・CLI           |
| `packages/api`    | Hono で SQLite を JSON 配信、スクリーンショット静的配信 |
| `packages/web`    | Next.js 15 + React Flow + Tailwind の閲覧 UI            |

---

## CLI

```bash
# 直接実行する場合（コンテナ内）
docker compose --profile tools run --rm runner crawl \
  --url http://host.docker.internal:3000 \
  --max-depth 3 \
  --max-pages 50

# storageState を使う認証
docker compose --profile tools run --rm runner crawl \
  --url https://app.example.com \
  --storage-state /data/auth/storage-state.json

# login.ts によるログインフロー
docker compose --profile tools run --rm runner crawl \
  --url https://app.example.com \
  --login-script /workspace/packages/runner/auth/login.ts
```

### login script の書き方

```ts
// packages/runner/auth/login.ts
import type { Page, BrowserContext } from 'playwright';

export default async function login({ page }: { page: Page; context: BrowserContext }) {
  await page.goto('https://app.example.com/login');
  await page.fill('#email', process.env.LOGIN_EMAIL!);
  await page.fill('#password', process.env.LOGIN_PASSWORD!);
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle');
}
```

---

## SPA の扱い

URL が変わらない SPA 遷移も別画面として扱うため、各ページで以下を組み合わせた **シグネチャ** を生成します。

- `location.pathname` + `search` + `hash`
- 主要ランドマーク（`header`, `nav`, `main`, `footer`, `[role=main]` ...）のタグ階層 + 安定属性（`id`, `data-testid`, `role`, `aria-label`, `name`）

これにより、

- 同じ URL でも DOM 構造が違う → 別ノード
- 構造が同じで動的テキストだけ違う → 同一ノード
- URL も DOM もほぼ同じ → 同一ノード（同じ画面とみなす）

詳細は `packages/runner/src/crawl/signature.ts`。

---

## 開発

### 必要なもの

- Docker / Docker Compose

> Node を入れる必要はありませんが、IDE 補完用に Node 22 + pnpm を入れておくと快適です。

### 主なコマンド

```bash
make up           # web + api 起動（migrate も自動実行・ホットリロード）
make logs         # ログ追従
make crawl URL=…  # クロール実行
make migrate      # SQLite スキーマ初期化を明示再実行（通常は make up が自動で走らせる）
make clean-data   # ./data を全削除
make shell        # runner コンテナの shell に入る
```

ホスト Node でも開発したい場合:

```bash
pnpm install
pnpm --filter @testworker/api  run dev
pnpm --filter @testworker/web  run dev
pnpm --filter @testworker/runner run crawl -- --url http://localhost:3000
```

---

## データ

| パス                                  | 内容                               |
| ------------------------------------- | ---------------------------------- |
| `data/db/testworker.sqlite`           | run / page / edge / log メタデータ |
| `data/runs/<runId>/screenshots/*.png` | スクリーンショット                 |
| `data/auth/*.json`                    | （任意）`storageState` を置く場所  |

`./data` は `.gitignore` 済みです。

---

## Roadmap

testworker は **AI / 外部 SaaS 非依存** が方針（運用コストをゼロに保つため）。実現手段は常にルールベース / ローカル完結を選びます。

- [ ] アサーション DSL（クロール中に宣言的に検証）
- [ ] フォーム自動入力 / 認証フォームの宣言的記述
- [ ] 視覚差分による崩れ・誤遷移検知（pixel diff + DOM signature 変化 — ルールベース）
- [ ] HAR エクスポート
- [ ] CI 連携 / GitHub Actions レポーター
- [ ] 差分ビュー（前回 run との遷移グラフ diff）

---

## Contributing

Issue・PR 歓迎です。コードスタイル等は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照。

---

## License

[MIT](./LICENSE)
