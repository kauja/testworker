# Troubleshooting

testworker でよく遭遇する 5 種類の失敗と解決手順 (Intent #128 / Bolt: human-readable error)。

CLI が出力する `[testworker hint]` 行で本ファイルへ誘導されている。

## 1. `origin mismatch — same origin only` で 1 ページも巡回されない

### 症状

```
[testworker] cross-origin redirect skipped: https://example.com → https://login.example.com
[testworker] crawl completed: 1 pages, 0 edges
```

start URL は踏めるが、 そのページが別 origin (subdomain / 別 host) に redirect され、 sameOriginOnly が有効なので捨てている。 結果 1 ページだけのつまらない地図になる。

### 原因

`sameOriginOnly: true` (デフォルト) は **scheme + host + port が完全一致** する URL しか踏まない。 `https://example.com → https://www.example.com` も別 origin 扱い。

### 解決

- 一致する canonical な URL を start に使う (例: \`https://www.example.com\` 直接)
- 別 origin を許可するなら `--same-origin-only false` (CLI) または \`CrawlOptions.sameOriginOnly: false\` を設定

## 2. `login fail` / 認証画面で巡回が止まる

### 症状

login 画面で `requestfailed` / 401 / 302 が大量に出て先に進まない。 storage-state も login script も指定していない。

### 原因

認証付きサイトには **事前に session を渡す** 必要がある。 何も渡さない = 未ログイン状態でクロール。

### 解決

2 つの選択肢:

**A. storage-state を使う (推奨)**:

```bash
# Playwright codegen で対話的にログイン → state を保存
pnpm --filter @testworker/runner exec playwright codegen --save-storage=data/auth/storage-state.json https://app.example.com
# クロール時に渡す
make crawl URL=https://app.example.com STORAGE_STATE_PATH=data/auth/storage-state.json
```

**B. loginScript を書く** (動的に毎回ログインする場合):

```typescript
// packages/runner/auth/login.ts (.gitignore 配下)
export default async function login({ page }) {
  await page.goto('https://app.example.com/login');
  await page.fill('#email', process.env.LOGIN_EMAIL!);
  await page.fill('#password', process.env.LOGIN_PASSWORD!);
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle');
}
```

秘密値は **環境変数で渡し**、 file には書かない (リポジトリへの commit 事故を防ぐ)。

## 3. `nav failed: timeout` で大量にスキップされる

### 症状

```
[testworker] nav failed: https://example.com/heavy-page (Timeout 15000ms exceeded.)
```

### 原因

デフォルト navTimeout は **15 秒**。 重いページや低速回線では足りない。

### 解決

```bash
make crawl URL=... NAV_TIMEOUT_MS=60000   # 60 秒に延長
```

または `CrawlOptions.navTimeoutMs` を指定。 上限は 120 秒。

## 4. `skipped by robots.txt` でほとんど踏めない

### 症状

```
[testworker] skipped by robots.txt: https://example.com/admin/
```

### 原因

`respectRobots: true` (デフォルト、 Issue #101) で robots.txt の `Disallow` を遵守している。 自分のサイトで管理 area を巡回したいケースで邪魔になる。

### 解決

自分のサイトを scan する場合のみ:

```bash
make crawl URL=... RESPECT_ROBOTS=false
```

他人のサイトに対しては **必ず true のまま** にすること (Bot として行儀よく振る舞う)。

## 5. `certificate` エラー / `net::ERR_CERT_AUTHORITY_INVALID`

### 症状

localhost / staging の自己署名証明書サイトに対して TLS エラー。

### 原因

Playwright は default で証明書を検証する。 自己署名は弾かれる。

### 解決

ローカル開発用なら start URL の scheme を **http** に変えるのが最も安全:

```bash
make crawl URL=http://localhost:3000   # NOT https://localhost:3000
```

どうしても https を使うなら、 開発用 CA (mkcert 等) を OS に登録するか、 `chromium.launch({ ignoreHTTPSErrors: true })` を patch する (将来 issue 化)。

## 6. ホストのファイルは健全なのに web が全 route 500 (Internal Server Error)

### 症状

```
Error:   x Merge conflict marker encountered.
    ,-[ /workspace/packages/web/src/lib/api.ts:34:1]
```

ホスト側のソースに `<<<<<<<` 等の marker は無いのに、 `next dev` の SWC AST がブランチ切替前後の cache を握り続けて 500 を吐く。 `docker compose restart web` 単独では治らない。

### 原因

`next dev` の SWC / webpack persistent cache (`packages/web/.next/cache` および `.swc/`) が bind mount 越しに stale 化。 branch switch / merge / rebase 後にファイル mtime と AST cache の整合が壊れる (#221)。

### 解決

ワンコマンドで cache を捨てて web を再起動:

```bash
make web-reset
```

内部で `rm -rf packages/web/.next packages/web/.swc` → `docker compose restart web`。 cold start ぶん 10〜20 秒余計にかかるが、 silent 500 は確実に消える。

予防的に毎起動で cache を消したい場合は、 web service を一旦停止してから `make up` する (`make down && make up`)。

## 関連

- Issue #128 (intent: 対象化の容易さ)
- Issue #93/#94 (sameOrigin redirect / frontier dedup) — 既に修正済み
- Issue #101 (respect-robots) — 既に実装済み
- Issue #221 (`.next` / `.swc` cache 汚染検知 / 自動 reset)
