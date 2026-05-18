#!/usr/bin/env bash
# main ブランチに保護ルールを適用するスクリプト。
#
# 適用内容:
#  - PR 経由のマージのみ許可（直接 push 禁止）
#  - レビュー 1 件以上必須
#  - 古いレビューは新コミットで dismiss
#  - 必須ステータスチェック: ci / node, ci / docker
#  - 会話の解決必須
#  - 管理者にも適用
#  - force push / 削除を禁止
#
# 前提:
#  - gh CLI 認証済み
#  - リポジトリのオーナー権限を持つトークン
#
# Usage: ./scripts/setup-branch-protection.sh [owner/repo]

set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
BRANCH="${BRANCH:-main}"

echo "Applying branch protection to ${REPO}@${BRANCH} ..."

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/${REPO}/branches/${BRANCH}/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "typecheck / lint / build (Node)" },
      { "context": "docker build smoke" }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
JSON

# Auto-merge / Squash merge を許可
gh api --method PATCH "repos/${REPO}" \
  -f allow_auto_merge=true \
  -f allow_squash_merge=true \
  -f allow_merge_commit=false \
  -f allow_rebase_merge=false \
  -f delete_branch_on_merge=true \
  >/dev/null

echo "Done."
