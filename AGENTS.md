# AGENTS.md — testworker での AI エージェントの動き方

このリポジトリで動くすべての AI エージェント（Claude Code を含む）への指針。
**これはプロジェクトオーナーから AI へのハーネス（ガードレール）であり、振る舞いの契約。**

## 思想

オーナーが求めるのは「完成された提案」であって「逐一の確認」ではない。エージェントは自分で最良と思う形を作り、PR として提示する。オーナーは PR をレビューしてフィードバックを返す。**改善ループ** をこの単位で回す。

→ 中間で「これでいい？」と質問するのは時間の無駄。
→ ただし**拡大解釈はしない**。許可された範囲を超える振る舞いは禁止。
→ 確認は **絶対に後戻りできない判断のみ** に絞る。

## 自律で進める（確認しない）

- **次タスクの選択・PR 戦略・スコープ判断・実装方針**（複数選択肢を提示してユーザに選ばせるのではなく、自分で最良と思う案を採用して進める）
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

優先度 (`priority:p0` → `p1` → `p2`) 順に Issue を消化し、完了時に「報告」する（質問ではなく）。CLAUDE.md 冒頭「最重要ルール — 自律実行」も参照。

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

### 例外: maintainer + Claude Code の admin bypass merge

`.claude/settings.json` の allow に **`gh pr merge --squash --admin*`** と **`gh pr update-branch *`** を入れている。これは maintainer (有坂) と Claude Code (admin token) が CI 完走を待たずに自分の PR を merge できるようにするための **明示的な例外** であり、 contributor 経路（他者の PR）は依然 branch protection + CI で守られる。

- 「保護を弱める」変更ではあるが maintainer の意思決定として確定済み（Issue #54）
- Claude Code が `gh pr merge --squash --admin` を発行できるのは「自分が作った PR を進めるため」だけに使う。他者の PR をこのコマンドで先回り merge してはならない（review 必要なら依然人手で）。
- 一般 contributor の PR は CI green + maintainer review を経てから auto-merge する従来フローを維持する。

## 拡大解釈の禁止（具体例）

- 「PR 作成 OK」だから「auto-merge ルールを変更してよい」とは思わない
- 「ファイル編集 OK」だから「`.env` を書いてよい」とは思わない
- 「`gh pr` 系 OK」だから「`gh repo delete` も雰囲気 OK」とは思わない
- 「テスト対象アプリを参照」OK だから「リポジトリ内に置いてよい」とは思わない
- 1 つ許可されたら隣の似た操作も許可、というロジックを取らない

## 公開してはいけないもの（絶対）

| 種類                     | 理由                           | 置き場所                                                               |
| ------------------------ | ------------------------------ | ---------------------------------------------------------------------- |
| テスト対象アプリのコード | 他者の知財・社内コードの可能性 | リポジトリ外に置き、`docker-compose` から bind mount または URL で参照 |
| `.env`, credentials      | 当然                           | リポジトリ外 / Vault                                                   |
| `storage-state.json`     | セッショントークンを含む       | `auth/`（`.gitignore` 済み）                                           |
| HAR / Cookies            | 個人情報を含み得る             | `data/runs/`（`.gitignore` 済み）                                      |
| 取得スクリーンショット   | 個人情報 / 業務情報が映る      | 同上                                                                   |

**「`.gitignore` に追加すればコミットしてよい」は誤り**。そもそも testworker のツリーに置かない。

## Issue ドリブン開発（必読）

このリポジトリは **「Issue を作る → 見つける → 処理する」** のサイクルで進める。意思決定の歴史的経緯は `docs/decisions/`（gitignore 済み、ローカル個人ログ）に保管している。

### 作業中に「対応が必要」と感じたら、即 Issue を立てる

**取り組みやすい原則**: 作業中に気付いた以下のものは **その PR に混ぜず、新しい Issue として起票** すること。

- 関係ないバグ・改善案
- 「これも直したい」と感じた周辺コード
- TODO コメントの内容
- ドキュメント不足
- フォローアップが必要だが今 PR では出来ない事項

**Why**: 「ついで対応」で PR が肥大化すると、レビューが困難になり、auto-merge も止まりやすい。1 PR = 1 関心事を守るため、混入を Issue として外出しする。

**How**:

```bash
gh issue create \
  --title "<type>: <short imperative>" \
  --body "## 背景\n## やること\n## 関連\n- PR で発見: #<this PR>" \
  --label "<type-label>,area:<area>,priority:p2"
```

起票したら **元の PR には Issue 番号だけ書く**（"フォローアップ: #N"）。混ぜない。

### ラベル運用

| カテゴリ | ラベル                                                                             |
| -------- | ---------------------------------------------------------------------------------- |
| Type     | `bug` / `enhancement` / `chore` / `docs` / `refactor` / `question`                 |
| Area     | `area:runner` / `area:api` / `area:web` / `area:ci` / `area:docs` / `area:harness` |
| Priority | `priority:p0` (緊急) / `priority:p1` (近いうち) / `priority:p2` (やれたら)         |
| Status   | `status:ready` / `status:blocked` / `status:in-progress`                           |

Issue 起票時に **Type と Area は必ず付ける**。Priority は迷ったら `p2`。

### 次にやる Issue の見つけ方

`status:in-progress` は他エージェントが claim 中なので除外する。

```bash
# p0 / p1 候補（status:in-progress は --search で明示除外）
gh issue list --search 'is:open label:"status:ready" label:"priority:p0" -label:"status:in-progress"' --repo kauja/testworker
gh issue list --search 'is:open label:"status:ready" label:"priority:p1" -label:"status:in-progress"' --repo kauja/testworker

# 全候補（claim 状況も見たい場合）
gh issue list --label "status:ready" --repo kauja/testworker --json number,title,labels
```

**選び方**: `priority:p0` を最優先、なければ `priority:p1`、依存（`blockedBy`）がないもの。同優先度なら ID 昇順。

### 重複着手を防ぐ（status:in-progress で claim）

**複数エージェントが同時稼働しうる前提のリポジトリ**。claim せずに着手すると同じ Issue を 2 人が並行実装し、片方の PR は無駄になる。**claim → 実装 → release** の流れを必ず守る。

#### 1. claim する（着手の最初に必ず）

実装に取り掛かる**前に** `status:in-progress` を付与し、`status:ready` を外す。**ブランチ作成より前**に行う（claim 前にブランチを切ると他エージェントから見えない作業が走る）。

```bash
N=<issue-number>
gh issue edit "$N" --remove-label "status:ready" --add-label "status:in-progress" \
  --repo kauja/testworker

# claim 直後に再フェッチして自分のラベルが付いていることを確認（競合検出）
gh issue view "$N" --repo kauja/testworker --json labels --jq '.labels[].name'
```

claim と同時に Issue に短くコメントを残すと、人間レビュアからも進行状況が見える:

```bash
gh issue comment "$N" --repo kauja/testworker \
  --body "Claiming this. Working on branch \`<type>/issue-$N-<scope>\`."
```

#### 2. release する（PR merge / 中止時）

- **PR が merge された**: `Closes #N` で Issue が自動 close され、ラベルは結果的に意味を持たなくなる。明示削除は不要
- **作業を中断する場合**: `status:in-progress` を外し、`status:ready` または `status:blocked` に戻す。理由をコメントに残す
- **長期 stale**（着手後 24h 経っても PR が無い / draft のまま）: 他エージェントが claim 上書きしてよい。元の担当に「奪取するよ」のコメントを残してから

```bash
# 中止
gh issue edit "$N" --remove-label "status:in-progress" --add-label "status:ready" \
  --repo kauja/testworker
gh issue comment "$N" --repo kauja/testworker --body "Releasing — <reason>."

# 他人の claim を奪取（24h 以上動きが無い場合のみ）
gh issue comment "$N" --repo kauja/testworker \
  --body "Taking over — previous claim has been stale for >24h with no PR."
gh issue edit "$N" --remove-label "status:in-progress" --add-label "status:in-progress" \
  --repo kauja/testworker
```

#### 3. 競合した場合（同時 claim）

GitHub のラベル操作はアトミックではないので、同時刻に 2 エージェントが claim すると両方成功しうる。**claim 直後の再フェッチ** で先着を確認する運用とし、**Issue 番号の若い順を譲り合いの基準**にする（同じ Issue を 2 人が claim していたら、新しい PR / 新しい claim コメントの側が降りる）。

### Issue を処理する

1. **claim**: `status:ready` → `status:in-progress`（上記参照）
2. ブランチ作成: `<type>/issue-<N>-<short-kebab>` 例: `feat/issue-12-export-har`
3. 実装 → commit（こまめに）→ push
4. PR 作成、description に **`Closes #N`** を必ず書く（merge で自動 close）
5. `auto-merge` ラベル付与、CI 待ち
6. merge 後、Issue が close されているか確認
7. 中止する場合は **release**（`status:in-progress` を外す）を忘れない

### 軽微な作業に Issue は不要

- typo 修正
- コメントの誤字
- 整形だけの prettier 適用

これらは PR タイトルで完結。

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

## 並列開発は worktree で隔離する（必須）

2 つ以上のエージェント / タスクが同時にファイルを編集する可能性がある場合、**各 worker は独立した git worktree で作業する**。共通の working tree を踏み合うと `index` / `pnpm-lock.yaml` / SQLite / `node_modules` / `.env` が破壊的に衝突し、後追いの cleanup コストが PR 1 本ぶんを軽く超える。

### シナリオ別の正規ルート

| シナリオ                                           | 手段                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Claude Code の `Agent` tool で並列 subagent を起動 | `isolation: "worktree"` を**必ず**指定（書き込みが発生する subagent はすべて対象）                                       |
| 手元で複数ブランチを同時に編集（割り込み対応など） | `git worktree add ../testworker-<scope> <type>/issue-<N>-<scope>` で別ディレクトリに切り出して作業                       |
| 5 件以上の独立タスクを fan-out する大規模並列      | `python scripts/orchestrate.py run <plan>.yaml`（`.orchestrate/worktrees/<id>/` で自動隔離。詳細は `scripts/README.md`） |

並列度の上限は CLAUDE.md の「Workflow Rules」に従う（default 2、最大 3）。fan-out 前にスコープの完全な一覧をユーザに提示してから起動する。

### 例外: 読み取り専用は隔離不要

調査 / grep / 型確認 / コード review だけの subagent（`Explore` 等）は worktree 不要。**書き込みが発生する瞬間に worktree に切り替える**（途中から `Edit`/`Write` を始めるなら最初から worktree で起動する）。

### クリーンアップ

- `git worktree list` で残骸を確認
- `git worktree remove <path>` で個別削除
- `python scripts/orchestrate.py cleanup` で `.orchestrate/worktrees/` を一括削除
- 残骸を放置すると次の `git worktree add` が同名で衝突する。完了したら必ず片付ける

### 禁止事項

- 並列実行中の worker が **main の working tree**（このリポジトリのルート）に書き込む — 他 worker の index を巻き込んで破壊する
- 並列 worker 同士が**同じブランチ**に push — merge 競合の温床
- 並列 worker が同時に **`pnpm install` / lockfile 更新** を走らせる — `pnpm-lock.yaml` を変えるタスクは並列にせず、必ず直列化する
- 並列 worker が同時に **`make migrate` / SQLite 書き込み** を走らせる — DB を `./data/` 配下で共有しているなら、書き込み系タスクは worktree 内の独立 `DATA_DIR` を使うか直列化する

### worktree を作ったエージェント自身の責務

- worktree 起動時に `pwd` で現在地を確認し、誤って親リポに書き込まないこと
- 完了報告時に「worktree path / branch / PR URL / 残骸 cleanup の有無」を必ず添える
- 親エージェント（supervisor）は worker の cleanup を確認してから次の fan-out に進む

## ハーネス（物理的な仕組み）

| 仕組み                | 場所                                   | 役割                                                    |
| --------------------- | -------------------------------------- | ------------------------------------------------------- |
| permission allow/deny | `.claude/settings.json`                | 危険コマンドの literal block                            |
| Bash guard hook       | `.claude/hooks/guard-bash.mjs`         | 文脈付き危険コマンドの block                            |
| Write guard hook      | `.claude/hooks/guard-write.mjs`        | 秘密値・私的ディレクトリへの書き込み block              |
| Commit scan hook      | `.claude/hooks/scan-commit.mjs`        | commit 直後に秘密情報パターンを検知して警告             |
| Auto-format hook      | `.claude/hooks/post-edit-format.mjs`   | Write/Edit 後に prettier 自動適用                       |
| Stop 品質チェック     | `.claude/hooks/stop-quality-check.mjs` | 会話末尾で変更パッケージの typecheck を流し、結果を返す |
| ブランチ保護          | GitHub                                 | main は PR + CI 通過 + レビュー必須                     |
| `auto-merge` workflow | `.github/workflows/auto-merge.yml`     | ラベル付き PR を CI 通過後に squash merge               |
| Secret scan workflow  | `.github/workflows/secret-scan.yml`    | gitleaks で PR ごとに走査                               |
| `.gitignore`          | `.gitignore`                           | テスト対象・auth・data を tree から弾く                 |

エージェントはこれらを**自分のためにも**機能させる。煩わしくても止められたら理由を読み、抜け道を探さずに方針を改めること。

## 改善ループ

オーナーが何かを言ったら:

1. **意図を 1 つに読む**（複数の解釈があるなら最も自然なものを選ぶ。聞き返すコストの方が高い）
2. **完成形を作る**（中間状態を見せない）
3. **PR / 提案として提示**（差分が見える形で）
4. **フィードバックを次ループへ**

「拡大解釈なく、完成形を提示する」のバランスは難しいが、迷ったら **「自分が公開リポジトリの単独メンテナだったら何をするか」** を判断軸にする。
