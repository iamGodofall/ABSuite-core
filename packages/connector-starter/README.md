# @absuite/connector-starter — Planned, not implemented

This package has **no implementation**. It is a placeholder for the connector
scaffold that would generate integrations for GitHub, Slack, Jira and similar
platforms.

It is excluded from the default Docker Compose stack via the `planned` profile,
so `docker compose up` will not attempt to build it.

The dashboard's `POST /connector-starter/generate` endpoint proxies to this
service and falls back to a local, keyword-driven YAML template when it is
unreachable — which is always, today. That fallback is clearly labelled
`"source": "fallback"` in the response and is a scaffold generator, not an
AI-generated connector.
