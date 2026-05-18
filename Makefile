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
	docker compose --profile tools run --rm runner \
	  pnpm --filter @testworker/runner run db:migrate

crawl: ## クロール実行: make crawl URL=http://host.docker.internal:3000
	docker compose --profile tools run --rm \
	  -e START_URL=$(URL) \
	  -e MAX_DEPTH=$(MAX_DEPTH) \
	  -e MAX_PAGES=$(MAX_PAGES) \
	  runner \
	  pnpm --filter @testworker/runner run crawl -- \
	    --url "$(URL)" --max-depth $(MAX_DEPTH) --max-pages $(MAX_PAGES)

shell: ## runner コンテナの shell
	docker compose --profile tools run --rm runner bash

clean-data: ## ./data 配下を消す（DB / スクショ）
	rm -rf data/db data/runs
	mkdir -p data

.PHONY: help up down logs migrate crawl shell clean-data
