# Corporate Card System

Palette OS-native corporate card management app.

Palette OS provides authentication and organization member context. This app
stores corporate-card cards, settlement claims, approval workflow snapshots, and
approval decisions in app-owned organization-scoped tables.

Approval paths are resolved through the local JSON-backed hierarchy service for
now. The resolved approver chain is stored as an immutable claim snapshot for
audit purposes.

## Talk notices

The app posts settlement notices into Palette Talk as its own agent identity
(`ctx.talk` from `palette_sdk`, `chat:write` in the manifest): one when a
settlement is submitted, one when it is approved or rejected.

An app can only post into channels its agent was invited to, so nothing is sent
until a member invites the Corporate Card System agent to a channel the way they
invite any agent. Check what the app can reach:

```bash
curl -s .../api/v1/plugins/corporate-card-system/talk/channels
```

Set `CORPORATE_CARD_TALK_CHANNEL` (env/secret) or a `talk_channel` install
config value to pin one channel; otherwise the first channel the agent sits in
is used. Talk is optional everywhere: no agent seat, no permission, or a runtime
without the service simply means no notice, never a failed settlement.

## Local setup

Copy `.env.example` to `.env` and fill in the secrets you use locally.

```bash
cp .env.example .env
```

Install dependencies:

```bash
npm install
```

Start the local database (Postgres on port 55437, matching `.env`):

```bash
docker compose up -d       # start
docker compose ps          # check health
docker compose down        # stop, keeping data
docker compose down -v     # stop and wipe the volume
```

Tables are created from the SQLAlchemy models on backend startup, so no
migration step is needed for `pltt dev`.

Docker is optional: unset `PALETTE_DEV_DATABASE_URL` in `.env` and the dev
simulator falls back to a local SQLite file instead.

Run the app through the Palette CLI:

```bash
pltt dev
pltt test
pltt package
```

Publish a build:

```bash
npm run publish:staging
npm run publish:production
```
