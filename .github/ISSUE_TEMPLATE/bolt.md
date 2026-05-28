---
name: ⚡ Bolt (Actionable Slice of an Intent)
about: 1-2 週で動かせる Intent の構成要素。1 PR で閉じる規模
title: 'bolt: '
labels: ['type:bolt', 'stage:draft']
---

> **Bolt とは**: Intent を割って 1 PR（500 行目安）で完結する作業単位。**必ず parent Intent を持つ**。

## Parent Intent

> **Intent #<番号>** — <Intent タイトルの短い再掲>

このフィールドが空 / 該当 Intent が無いなら、それは Bolt ではなく `enhancement` か `bug` として起票し直すこと。

## やること（What）

1.
2.
3.

## なぜこれが Intent に効くか（Why this Bolt）

Intent の Success Metrics のうち、**どれをどう前進させるか** 1-2 文で。

## 完了条件（Done Criteria）

PR が merge される時点で満たされるべき観測可能な条件:

- [ ]
- [ ]
- [ ]

## Out of scope（やらないこと）

ここで踏み込まない隣接領域 — 別 Bolt / 別 Intent に外出しする:

-
-

## 関連

- Parent Intent: #
- 既存 PR / Issue:
-

---

<!--
Lifecycle:
  stage:draft   — Parent Intent との関係 / 完了条件確定前
  stage:active  — claim 済み（status:in-progress と併用）
  stage:done    — PR merge で自動 close

詳細は AGENTS.md「AI-DLC: Intent → Bolt の運用」を参照。
-->
