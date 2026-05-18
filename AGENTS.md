# AGENTS.md — testworker での AI エージェントの動き方

このリポジトリで動くすべての AI エージェント（Claude Code を含む）への指針。
**これはプロジェクトオーナーから AI へのハーネス（ガードレール）であり、振る舞いの契約。**

## 思想

オーナーが求めるのは「完成された提案」であって「逐一の確認」ではない。エージェントは自分で最良と思う形を作り、PR として提示する。オーナーは PR をレビューしてフィードバックを返す。**改善ループ** をこの単位で回す。

→ 中間で「これでいい？」と質問するのは時間の無駄。
→ ただし**拡大解釈はしない**。許可された範囲を超える振る舞いは禁止。
→ 確認は **絶対に後戻りできない判断のみ** に絞る。

## 自律で進める（確認しない）

- ファイル作成・編集・削除（リポジトリ内、`.gitignore` 配下を除く）
- ブランチ作成（`feat/*`, `fix/*`, `chore/*`, `docs/*`, `refactor/*`）
- コミット作成（こまめに、論理単位ごとに）
- feature ブランチへの push
- PR 作成（draft 含む）
- `auto-merge` ラベル付与
- `pnpm`, `make`, `docker compose` の実行
- CI の確認 / ログ取得
- Issue / Label / PR コメントの作成・編集
- 公知 OSS の追加（ライセンス互換のもの）

## 確認を取る（後戻りできない判断のみ）

- `main` への直接の影響を伴う操作（直 push / 強制 push / 履歴改変）
- ブランチ保護・auto-merge ルール・CI ワークフローの**保護を弱める**変更
- リポジトリの可視性変更（public ↔ private）
- リポジトリ・ブランチの**削除**
- 認証情報の操作（`gh auth logout` 等）
- ライセンス変更
- 外部サービスへのデプロイ・新規アカウント連携
- 機密と判定がつかないデータの公開

上記は **ハーネス（`.claude/settings.json` の `deny` + `.claude/hooks/`）でも物理的にブロック** している。エージェントが意図的に回避しようとしてはならない。

## 拡大解釈の禁止（具体例）

- 「PR 作成 OK」だから「auto-merge ルールを変更してよい」とは思わない
- 「ファイル編集 OK」だから「`.env` を書いてよい」とは思わない
- 「`gh pr` 系 OK」だから「`gh repo delete` も雰囲気 OK」とは思わない
- 「テスト対象アプリを参照」OK だから「リポジトリ内に置いてよい」とは思わない
- 1 つ許可されたら隣の似た操作も許可、というロジックを取らない

## 公開してはいけないもの（絶対）

| 種類 | 理由 | 置き場所 |
| ---- | ---- | -------- |
| テスト対象アプリのコード | 他者の知財・社内コードの可能性 | リポジトリ外に置き、`docker-compose` から bind mount または URL で参照 |
| `.env`, credentials | 当然 | リポジトリ外 / Vault |
| `storage-state.json` | セッショントークンを含む | `auth/`（`.gitignore` 済み） |
| HAR / Cookies | 個人情報を含み得る | `data/runs/`（`.gitignore` 済み） |
| 取得スクリーンショット | 個人情報 / 業務情報が映る | 同上 |

**「`.gitignore` に追加すればコミットしてよい」は誤り**。そもそも testworker のツリーに置かない。

## こまめな commit と適切な PR 戦略

### コミット粒度

- 1 つの commit = 1 つの論理変更（読める単位で）
- `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:` のプレフィックスを推奨
- 失敗実験を含めず、後で reviewer が辿れる粒度を保つ
- `--amend` 禁止（履歴改変・force push の温床）
- `--no-verify` 禁止（hook bypass）

### ブランチ運用

```
main (protected)
  └─ feat/<scope>     新規機能
  └─ fix/<scope>      バグ修正
  └─ chore/<scope>    雑務（CI / deps / config）
  └─ docs/<scope>     ドキュメントのみ
  └─ refactor/<scope> 振る舞いを変えないリファクタ
```

### PR ルール

- 1 PR = 1 関心事（混ぜない）
- 中規模まで（変更行 500 行を目安に、超えるなら分割）
- PR テンプレートを必ず埋める
- ローカルで `pnpm -r run typecheck` が通る状態で PR を出す
- 出した PR には `auto-merge` ラベルを付ける（CI 通過 → 自動 squash merge）
- レビュー指摘は新規 commit で対応（force push しない）
- マージ後にブランチは自動削除（リポジトリ設定済み）

### 「自己 review」チェックリスト

PR 出す前にエージェント自身が以下を確認:

- [ ] 機密情報（.env, credentials, トークン, 私的 fixture）を含めていない
- [ ] テスト対象アプリのコード / バイナリを含めていない
- [ ] `git diff main..HEAD --stat` で意図しないファイルが混じっていない
- [ ] PR タイトル・description が「Why」を説明している（「What」はコードに任せる）
- [ ] CI が走ること（typecheck / lint / build / docker build smoke）

## ハーネス（物理的な仕組み）

| 仕組み | 場所 | 役割 |
| ------ | ---- | ---- |
| permission allow/deny | `.claude/settings.json` | 危険コマンドの literal block |
| Bash guard hook | `.claude/hooks/guard-bash.mjs` | 文脈付き危険コマンドの block |
| Write guard hook | `.claude/hooks/guard-write.mjs` | 秘密値・私的ディレクトリへの書き込み block |
| Commit scan hook | `.claude/hooks/scan-commit.mjs` | commit 直後に秘密情報パターンを検知して警告 |
| Auto-format hook | `.claude/hooks/post-edit-format.mjs` | Write/Edit 後に prettier 自動適用 |
| Stop 品質チェック | `.claude/hooks/stop-quality-check.mjs` | 会話末尾で変更パッケージの typecheck を流し、結果を返す |
| ブランチ保護 | GitHub | main は PR + CI 通過 + レビュー必須 |
| `auto-merge` workflow | `.github/workflows/auto-merge.yml` | ラベル付き PR を CI 通過後に squash merge |
| Secret scan workflow | `.github/workflows/secret-scan.yml` | gitleaks で PR ごとに走査 |
| `.gitignore` | `.gitignore` | テスト対象・auth・data を tree から弾く |

エージェントはこれらを**自分のためにも**機能させる。煩わしくても止められたら理由を読み、抜け道を探さずに方針を改めること。

## 改善ループ

オーナーが何かを言ったら:

1. **意図を 1 つに読む**（複数の解釈があるなら最も自然なものを選ぶ。聞き返すコストの方が高い）
2. **完成形を作る**（中間状態を見せない）
3. **PR / 提案として提示**（差分が見える形で）
4. **フィードバックを次ループへ**

「拡大解釈なく、完成形を提示する」のバランスは難しいが、迷ったら **「自分が公開リポジトリの単独メンテナだったら何をするか」** を判断軸にする。
