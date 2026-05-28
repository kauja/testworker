.DEFAULT_GOAL := help

URL ?= http://host.docker.internal:3000
MAX_DEPTH ?= 3
MAX_PAGES ?= 50

help: ## このヘルプ
	@awk 'BEGIN{FS=":.*?## "}/^[a-zA-Z_-]+:.*?## /{printf "  \033[36m%-18s\033[0m %s\n",$$1,$$2}' $(MAKEFILE_LIST)

up: ## web + api を起動（ホットリロード）
	docker compose up --build

down: ## 全停止
	docker compose down

logs: ## ログ追従
	docker compose logs -f

migrate: ## SQLite スキーマ初期化
	# Dockerfile の ENTRYPOINT が `pnpm --filter @testworker/runner run` で固定
	# されているので、 CMD として渡すのは script 名 (db:migrate) だけにする。
	# 旧版は `pnpm --filter ... run` を再度渡していて二重 wrap になり
	# 「`pnpm` という script が見つからない」 で fail していた (Issue #137)。
	docker compose --profile tools run --rm runner db:migrate

crawl: ## クロール実行: make crawl URL=http://host.docker.internal:3000
	# 同上。 ENTRYPOINT 後に `crawl` + 残り CLI 引数 (--url 等) を続ける。
	# 旧版は `pnpm ... run crawl --` を二重に渡しており、 `--` が tsx 側の
	# parseArgs に positional として混入し Zod の Invalid url で fail していた
	# (Issue #137)。
	docker compose --profile tools run --rm \
	  -e START_URL=$(URL) \
	  -e MAX_DEPTH=$(MAX_DEPTH) \
	  -e MAX_PAGES=$(MAX_PAGES) \
	  runner crawl \
	    --url "$(URL)" --max-depth $(MAX_DEPTH) --max-pages $(MAX_PAGES)

shell: ## runner コンテナの shell
	docker compose --profile tools run --rm runner bash

clean-data: ## ./data 配下を消す（DB / スクショ）
	rm -rf data/db data/runs
	mkdir -p data

.PHONY: help up down logs migrate crawl shell clean-data
