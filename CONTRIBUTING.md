# Contributing to testworker

Thanks for taking time to contribute. このドキュメントでは PR・Issue を出すうえで知っておくと早い情報を簡潔にまとめます。

## Issue を立てる前に

- 既存の Issue を検索してください（duplicate を避けるため）。
- バグ報告には以下を含めると助かります:
  - 再現手順（最小ケース）
  - 期待する挙動 / 実際の挙動
  - `docker compose version`, `uname -a`, ブラウザバージョン
  - 関連する `data/runs/<runId>` のスクリーンショットまたはログ

## 開発フロー

```bash
git clone <repo>
cd testworker
make up                          # web + api を起動
make crawl URL=http://host.docker.internal:3000   # サンプルクロール
```

- ブランチ命名: `feat/<scope>`, `fix/<scope>`, `docs/<scope>`, `chore/<scope>` を推奨
- 1 PR = 1 関心事
- 大きな変更を入れる前に Issue を立てて方針合意を取ると安全です

## コードスタイル

- TypeScript strict + `noUncheckedIndexedAccess`
- `pnpm -r run typecheck` が通ること
- フォーマットは `pnpm format`（Prettier）
- 不要なコメント・過剰な抽象化は避け、コードで意図が伝わる形を優先

## コミットメッセージ

Conventional Commits 推奨（任意）:

```
feat(runner): support cookie-based auth
fix(web): correct edge animation for spa-route
docs: clarify storageState usage
```

## DCO / Sign-off

軽量な DCO ベースで運用します。コミットに `-s` を付けて sign-off してください。

```bash
git commit -s -m "feat: ..."
```

## ライセンス

PR を送る時点で、内容を MIT ライセンスの下で公開することに同意したものとみなします。
