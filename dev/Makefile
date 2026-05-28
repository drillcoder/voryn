DEV_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
ROOT_DIR := $(abspath $(DEV_DIR)/..)
ENV_FILE := $(DEV_DIR)/.env
COMPOSE := docker compose --env-file $(ENV_FILE) --project-directory $(ROOT_DIR) -f $(DEV_DIR)/docker-compose.yml
TOOLS_RUN := $(COMPOSE) run --rm tools

.PHONY: \
	init ingestion-up ingestion-restart ingestion-stop \
	db-up db-restart db-stop down \
	install build lint test test-all db-init lint-fix test-coverage test-unit-coverage test-watch test-integration test-e2e test-live-rpc

# Инициализация.
init: install build db-init

# Установить зависимости в контейнере.
install:
	$(TOOLS_RUN) npm ci

# Инициализировать схему БД.
db-init: db-up
	$(TOOLS_RUN) npm run db:apply-sql -- src/sql/postgres-schema.sql

# Поднять контейнер с базой данных.
db-up:
	$(COMPOSE) up -d --wait postgres

# Рестарт контейнера с базой данных.
db-restart:
	$(COMPOSE) restart postgres

# Остановить контейнер с базой данных.
db-stop:
	$(COMPOSE) stop postgres

# Поднять ingestion окружение.
ingestion-up:
	$(COMPOSE) up -d head fetch sequencer retention

# Рестарт ingestion окружения.
ingestion-restart:
	$(COMPOSE) up -d --force-recreate head fetch sequencer retention

# Остановить ingestion окружение.
ingestion-stop:
	$(COMPOSE) stop head fetch sequencer retention

# Удалить контейнеры и тома.
down:
	$(COMPOSE) down -v

# Собрать проект.
build:
	$(TOOLS_RUN) npm run build

# Собрать тесты.
build-test:
	$(TOOLS_RUN) npm run build-test

# Проверить линтер.
lint:
	$(TOOLS_RUN) npm run lint

# Автоисправления линтера.
lint-fix:
	$(TOOLS_RUN) npm run lint:fix

# Запустить все тесты.
test-all:
	$(TOOLS_RUN) npm run test:all

# Запустить unit-тесты.
test:
	$(TOOLS_RUN) npm test

# Integration-тесты.
test-integration:
	$(TOOLS_RUN) npm run test:integration

# E2E-тесты.
test-e2e:
	$(TOOLS_RUN) npm run test:e2e

# Live RPC-тесты.
test-live-rpc:
	$(TOOLS_RUN) npm run test:live-rpc

# Тесты с покрытием.
test-coverage:
	$(TOOLS_RUN) npm run test:coverage

# Unit-тесты с покрытием.
test-unit-coverage:
	$(TOOLS_RUN) npm run test:unit:coverage

# Тесты в watch-режиме.
test-watch:
	$(TOOLS_RUN) npm run test:watch
