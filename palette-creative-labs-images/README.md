# Pltt Creative Palette Plugin

Run the local contract gate before publishing:

```bash
pltt build
pltt test --json
pltt package --json
```

Local database-backed development uses Postgres, not the CLI SQLite fallback.
Create `.env` from `.env.example`, then start the local Postgres service before
running `pltt dev`:

```bash
cp .env.example .env
docker compose up -d postgres
pltt dev
```

Expected preview flow:

```bash
pltt dev
pltt dev --cloud --env staging
```

`pltt dev` opens the app locally at `/apps/<plugin-id>`. `pltt dev --cloud`
publishes a temporary staging preview, returns the platform preview URL, and
lets you poll review state with `pltt status <publish-id>`.
