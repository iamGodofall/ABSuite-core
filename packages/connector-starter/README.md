# @absuitecore/connector-starter

Connector registry, credential verification and deterministic connector
scaffolding.

## What it does

- **Registry** — GitHub, Slack, Discord, Linear, Notion and a generic webhook.
  Each declares the environment it needs and reports honestly whether it is
  configured.
- **Verification** — checks credentials with a cheap, **read-only** call.
  Clicking "test" never posts a message or opens an issue as a side effect.
- **Actions** — execute real connector operations, with required inputs
  validated before any network call.
- **Scaffolding** — turns a description into a YAML manifest *and* compilable
  TypeScript. Deterministic and rule-based: no API key, and the same
  description always produces the same output, which matters when the result
  gets committed.

## Running

```bash
CAPKIT_HMAC_SECRET=$(openssl rand -hex 32) pnpm --filter @absuitecore/connector-starter dev
```

## API

```bash
# What is available, and what is configured?
curl localhost:8084/connectors

# Verify credentials (read-only)
curl -X POST localhost:8084/connectors/github/verify -H "Authorization: Bearer $TOKEN"

# Run an action
curl -X POST localhost:8084/connectors/github/actions/listIssues \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"owner":"iamGodofall","repo":"ABSuite-core"}'

# Generate a connector
curl -X POST localhost:8084/generate -H 'Content-Type: application/json' \
  -d '{"prompt":"Read GitHub issues and post them to Slack every 15 minutes"}'
```

Required scopes: `connector:read`, `connector:execute`.

Generation returns a `manifest`, ready-to-compile `typescript`, and the parsed
`spec` — including a suggested Edge-Run cron schedule when the description
implies a cadence.

## Security

Generic webhook targets must be `https`. Connector credentials are read from the
environment and are never returned in an API response.

## Configuration

All connector credentials are optional — each connector reports its own state.

| Variable | Connector |
|---|---|
| `GITHUB_TOKEN` | GitHub |
| `SLACK_BOT_TOKEN` or `SLACK_WEBHOOK_URL` | Slack |
| `DISCORD_WEBHOOK_URL` or `DISCORD_BOT_TOKEN` | Discord |
| `LINEAR_API_KEY` | Linear |
| `NOTION_TOKEN` | Notion |

## Known limitations

Scaffolding is rule-based keyword analysis, not a language model. It reliably
detects common integrations, verbs and cadences, but it will not infer intent
from an unusual description. It is a starting point to edit, not a finished
connector.
