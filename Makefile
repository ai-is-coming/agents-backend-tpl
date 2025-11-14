.PHONY: init

# Install Bun runtime
init:
	curl -fsSL https://bun.com/install | bash

.PHONY: install

# Install project dependencies with Bun
install:
	@if command -v bun >/dev/null 2>&1; then \
		bun install; \
	else \
		echo "bun not found. Run 'make init' first or use 'npm install'"; \
		exit 1; \
	fi

.PHONY: dev

# Start the Hono dev server with Bun
# If Bun is missing, ask the user to reinstall
dev:
	@if command -v bun >/dev/null 2>&1; then \
		echo "Using bun"; \
		bun --hot src/index.ts; \
	else \
		echo "bun not found. Please run 'make init' to install Bun, then re-run 'make dev'"; \
		exit 1; \
	fi

.PHONY: test

# Run tests
# Usage:
#   make test                             # run all tests
#   make test FILE=tests/routes/agent.chat.test.ts   # run a specific file
#   make test NAME="pattern"             # run tests whose name matches regex
#   make test FILE=tests/routes/agent.chat.test.ts NAME="pattern"  # both

test:
	@if command -v bun >/dev/null 2>&1; then \
		FILE_ARG="$(FILE)"; \
		if [ -n "$$FILE_ARG" ]; then \
			case "$$FILE_ARG" in \
				/*|./*) ;; \
				*) FILE_ARG="./$$FILE_ARG" ;; \
			esac; \
			if [ -n "$(NAME)" ]; then \
				bun test "$$FILE_ARG" --test-name-pattern "$(NAME)"; \
			else \
				bun test "$$FILE_ARG"; \
			fi; \
		else \
			if [ -n "$(NAME)" ]; then \
				bun test --test-name-pattern "$(NAME)"; \
			else \
				bun test; \
			fi; \
		fi; \
	else \
		echo "bun not found. Please run 'make init' to install Bun"; \
		exit 1; \
	fi

.PHONY: db-gen

# Pull database schema using Prisma
db-gen:
	npx prisma db pull --schema=src/db/prisma/schema.prisma
	npx prisma generate --schema=src/db/prisma/schema.prisma

.PHONY: db-migrate

# Run database migrations (auto-create database if not exists)
db-migrate:
	@if command -v bun >/dev/null 2>&1; then \
		bun run src/db/run-migrate.ts; \
	else \
		echo "bun not found. Please run 'make init' to install Bun"; \
		exit 1; \
	fi

.PHONY: lint

# Run linter and formatter checks (without fixing)
lint:
	@if command -v bun >/dev/null 2>&1; then \
		echo "Running Biome linter and formatter checks..."; \
		bunx biome check --diagnostic-level=info ./src ./tests; \
	else \
		echo "bun not found. Please run 'make init' to install Bun"; \
		exit 1; \
	fi

.PHONY: lint-fix

# Run linter and formatter with auto-fix
lint-fix:
	@if command -v bun >/dev/null 2>&1; then \
		echo "Running Biome linter and formatter with auto-fix..."; \
		bunx biome check --write --unsafe ./src ./tests; \
	else \
		echo "bun not found. Please run 'make init' to install Bun"; \
		exit 1; \
	fi

.PHONY: format

# Format code only
format:
	@if command -v bun >/dev/null 2>&1; then \
		echo "Formatting code with Biome..."; \
		bunx biome format --write ./src ./tests; \
	else \
		echo "bun not found. Please run 'make init' to install Bun"; \
		exit 1; \
	fi

.PHONY: typecheck

# Run TypeScript type checking
typecheck:
	@if command -v bun >/dev/null 2>&1; then \
		echo "Running TypeScript type checking..."; \
		bunx tsc --noEmit; \
	else \
		echo "bun not found. Please run 'make init' to install Bun"; \
		exit 1; \
	fi
