ENV_FILE ?= .env
DC := docker compose --env-file $(ENV_FILE) -p newsletter

.PHONY: up down restart logs ps psql migrate

up:
	$(DC) up -d
	@$(MAKE) wait-postgres

wait-postgres:
	@until [ "$$($(DC) ps -q postgres | xargs docker inspect -f '{{.State.Health.Status}}' 2>/dev/null)" = "healthy" ]; do sleep 1; done

down:
	$(DC) down

restart: down up

logs:
	$(DC) logs -f postgres

ps:
	$(DC) ps

psql:
	$(DC) exec postgres psql -U $${POSTGRES_USER:-newsletter} -d $${POSTGRES_DB:-newsletter}

migrate:
	set -a; . ./$(ENV_FILE); set +a; \
	PYTHONPATH=node_modules/@palettelab/cli/backend-sdk:backend/api DATABASE_URL="$$LOCAL_DATABASE_URL" \
		uv run python -c "import asyncio, os; from migration_runner import run_migrations; asyncio.run(run_migrations(os.environ['DATABASE_URL']))"
