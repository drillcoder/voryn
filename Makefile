COMPOSE := docker compose
TOOLS_RUN := $(COMPOSE) run --rm tools

.PHONY: \
	init ingestion-up ingestion-restart ingestion-stop \
	db-up db-restart db-stop down \
	install build lint test db-init lint-fix test-coverage test-watch test-e2e

# Инициализация.
init: install build db-init

# Поднять ingestion окружение.
ingestion-up:
	$(COMPOSE) up -d head fetch sequencer retention

# Рестарт ingestion окружения.
ingestion-restart:
	$(COMPOSE) up -d --force-recreate head fetch sequencer retention

# Остановить ingestion окружение.
ingestion-stop:
	$(COMPOSE) stop head fetch sequencer retention

# Инициализировать схему БД.
db-init: db-up
	$(TOOLS_RUN) npm exec -- voryn init

# Поднять контейнер с базой данных.
db-up:
	$(COMPOSE) up -d --wait postgres

# Рестарт контейнера с базой данных.
db-restart:
	$(COMPOSE) restart postgres

# Остановить контейнер с базой данных.
db-stop:
	$(COMPOSE) stop postgres

# Удалить контейнеры и тома.
down:
	$(COMPOSE) down -v

# Установить зависимости в контейнере.
install:
	$(TOOLS_RUN) npm ci

# Собрать проект.
build:
	$(TOOLS_RUN) npm run build

# Собрать тесты.
build-test:
	$(TOOLS_RUN) npm run build-test

# Проверить линтер.
lint:
	$(TOOLS_RUN) npm run lint

# Запустить тесты.
test:
	$(TOOLS_RUN) npm test

# Автоисправления линтера.
lint-fix:
	$(TOOLS_RUN) npm run lint:fix

# Тесты с покрытием.
test-coverage:
	$(TOOLS_RUN) npm run test:coverage

# Тесты в watch-режиме.
test-watch:
	$(TOOLS_RUN) npm run test:watch
