COMPOSE := docker compose
APP_EXEC := $(COMPOSE) exec app

.PHONY: up stop down install build lint test db-init lint-fix test-coverage test-watch

# Поднять контейнеры.
up:
	$(COMPOSE) up -d

# Остановить окружение.
stop:
	$(COMPOSE) stop

# Удалить контейнеры и тома.
down:
	$(COMPOSE) down -v

# Установить зависимости в контейнере.
install:
	$(APP_EXEC) npm ci

# Собрать проект.
build:
	$(APP_EXEC) npm run build

# Проверить линтер.
lint:
	$(APP_EXEC) npm run lint

# Запустить тесты.
test:
	$(APP_EXEC) npm test

# Инициализировать схему БД.
db-init:
	$(APP_EXEC) npm exec -- voryn db init

# Автоисправления линтера.
lint-fix:
	$(APP_EXEC) npm run lint:fix

# Тесты с покрытием.
test-coverage:
	$(APP_EXEC) npm run test:coverage

# Тесты в watch-режиме.
test-watch:
	$(APP_EXEC) npm run test:watch

