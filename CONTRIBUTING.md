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

### ブランチ & PR 戦略（必読）

- `main` は保護対象。直接 push 不可、force push 不可、PR + CI + 1 レビューが必須。
- 作業はすべて feature ブランチで:
  - `feat/<scope>` — 機能追加
  - `fix/<scope>` — バグ修正
  - `chore/<scope>` — 設定 / 依存 / CI
  - `docs/<scope>` — ドキュメント
  - `refactor/<scope>` — 振る舞いを変えないリファクタ
- 1 PR = 1 関心事（変更行 500 行を目安に、超えるなら分割）
- PR を出したら `auto-merge` ラベルを付与。CI 通過 + レビュー成立 で squash merge されます。
- コミットは `--amend` / `--no-verify` を使わないこと（履歴改変・hook bypass の温床）

### 公開してはいけないもの

- テスト対象アプリのコード（リポジトリ外に置き、`docker-compose` から bind mount / URL 参照）
- `.env`, トークン, 秘密鍵
- `storage-state.json`, HAR, 個人情報を含むスクリーンショット

→ `.gitignore` で防御していますが、**そもそも tree に置かない** ことを徹底してください。詳細は [`AGENTS.md`](./AGENTS.md) 参照（AI エージェント向けのハーネス）。

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
