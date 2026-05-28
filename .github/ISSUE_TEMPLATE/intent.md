---
name: 🎯 Intent (Product Goal)
about: あるべき姿 / Outcome を言語化する大きめの目標（4-8 週スパン）
title: 'intent: '
labels: ['type:intent', 'stage:draft']
---

> **Intent とは**: testworker の「あるべき姿」を Outcome ベースで言語化したもの。これ自体は PR で閉じない — 配下の Bolt が積み重なって完了に近づく。

## Why（背景・問題意識）

このユーザ / シナリオで、今は何が成り立っていないか。なぜ今これか。

## Outcome（あるべき姿 — 1 文で）

> 「<誰> が <どんな状況> で <何> できる」形式で 1 行。

## Success Metrics（測定可能）

達成判定に使う具体的な数字 / 観測可能な状態:

- [ ] (例) クロール後に「劣化ページ Top 5」をユーザが 1 クリックで開ける
- [ ] (例) Run 詳細を URL 1 本でレビュアに渡せる
- [ ] (例) 認証付きサイトの初回セットアップが 5 分以内

## Non-goals（この Intent でやらないこと）

スコープを絞るために、**やらないこと**を明示する。後続 Intent でやる、別ツールに任せる、など。

-
-

## Bolts（この Intent を構成する 1-2 週単位の作業）

`type:bolt` で起票し、各 Bolt は **この Issue 番号を Parent として記載**する。完了したらチェックを付ける。

- [ ] #
- [ ] #
- [ ] #

## 関連 / 参考

-
-

---

<!--
Lifecycle:
  stage:draft   — 議論中、Outcome / Metrics 確定前
  stage:active  — Bolts が走っている
  stage:done    — Metrics が満たされた（Issue close）

詳細は AGENTS.md「AI-DLC: Intent → Bolt の運用」を参照。
-->
