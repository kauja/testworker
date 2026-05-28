# docs/images

testworker README で参照するスクリーンショット / GIF を置くディレクトリ。

## 想定ファイル

- `runs-list.png` — `/` (runs 一覧) 画面のスクリーンショット
- `graph-view.png` — `/runs/<id>` (React Flow 遷移図 + detail panel) のスクリーンショット
- `demo.gif` — crawl 実行 → グラフ描画の流れ (10-30 秒、 5MB 未満、 無音)

## 取り込み手順

1. testworker をローカルで起動 (`make up && make crawl URL=...`)
2. ブラウザで `http://localhost:3000` / `http://localhost:3000/runs/<id>` を開く
3. dark mode 表示で macOS Screenshot (Cmd+Shift+5) で撮影 → 1280x800 程度に最適化
4. GIF は QuickTime 録画 → ffmpeg / gifski で圧縮
   ```bash
   ffmpeg -i input.mov -vf "fps=12,scale=720:-1" -loop 0 demo.gif
   gifsicle -O3 demo.gif -o demo.gif
   ```
5. このディレクトリに置いて `git add docs/images/` で commit

## 注意

- 出典が外部 URL / 別 OSS の screenshot を使うときは出典をこのファイルに明記すること
- リポジトリの bloat を避けるため、 単一ファイル 2MB を超えるなら git LFS 検討
- 撮影対象に秘密情報 (実 user / token / メールアドレス) が映らないこと
