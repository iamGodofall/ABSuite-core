# Putting an instance somewhere you can reach it

The Trust Operations Center reads six services over HTTP and a socket. Given
nothing to read, it reports `UNKNOWN` for every figure and says so in words —
which is correct behaviour and is also why a published static copy of the
interface can never show anything live. There is nothing behind it.

This document is about giving it something to be behind.

## What is already true

`docker-compose.yml` runs the real topology: seven containers on a private
network, one SQLite volume, published on `127.0.0.1` only. CD builds and pushes
an image per service to `ghcr.io` on every push to `main`. None of that needs
changing, and none of it is what this document replaces.

What it does not do is give you an address. Compose assumes a machine you
already have.

## The single-container instance

`deploy/Dockerfile` builds all six services and the orchestrator into one image
and `deploy/serve-all.mjs` runs them side by side, with the orchestrator
pointed at loopback rather than at Docker service names.

Nothing is stubbed. These are the same `dist/server.js` binaries compose runs,
against the same SQLite file, answering the same routes. The only difference is
where they can be reached from, and that is set entirely by environment
variables — which is why no source file has a deployment branch in it.

The trade is explicit: one container is one failure domain, and the services
cannot scale independently. For an instance whose job is to be looked at, that
is the right trade. For an installation holding records that matter, run the
compose file.

### Fly

```
fly launch --no-deploy      # names the app, keeps fly.toml
fly volumes create absuite_data --size 1
fly secrets set ABSUITE_PUBLIC_PASSWORD="$(openssl rand -base64 24)" \
                CAPKIT_ADMIN_KEY="$(openssl rand -base64 32)"
fly deploy
fly secrets list            # confirm both are set
```

`fly.toml` sets one always-warm machine, because `auto_stop_machines` would
make the first visitor wait for a cold start and the room would look broken
while it was in fact asleep.

### Render

Connect the repository as a Blueprint. `render.yaml` declares one Docker
service with a 1GB disk at `/data`, and generates both secrets for you — read
them from the service's Environment tab.

### Anywhere that runs a container

```
docker build -f deploy/Dockerfile -t absuite .
docker run -p 3001:3001 -v absuite-data:/data \
  -e ABSUITE_PUBLIC_PASSWORD=... -e CAPKIT_ADMIN_KEY=... absuite
```

## The password is not optional

`server.ts` binds loopback by default and warns when told to do otherwise,
because that process holds `CAPKIT_ADMIN_KEY` — the credential that mints
capability tokens — and can control services. Its own comment says to put an
authenticating proxy in front before exposing it.

On a platform that terminates TLS and routes straight to your container there
is no proxy to put anything in, so that advice read literally means "do not
deploy", and what happens instead is that people deploy it anyway. So:

Set `ABSUITE_PUBLIC_PASSWORD` and every route, including the static bundle, is
gated behind HTTP basic auth. The username is `absuite`. `/health` stays open,
because a platform health check cannot carry credentials and a gated one makes
the host declare the container dead.

Leave it unset and nothing changes — no gate, same as `pnpm room` and the same
as compose, both of which bind loopback where a password protects nobody.

Basic auth gates a demonstration instance. It is not an identity system and
does not pretend to be one. The moment this holds records that matter, replace
it with the real thing.

## What you will see

A deployed instance reports `LIVE`, `6/6 responding`, `CONNECTED`, and the
notice card is absent. The eight vertices show what `docs/CONSTITUTION.md` says
is built — five with evidence behind them, three without — because
`gen-architecture-layers.mjs` runs during the image build rather than trusting
whatever JSON happened to be committed.

An empty instance shows `ABSENT` where a figure would go, not zero. Nothing has
been recorded yet, and "nothing recorded" and "measured zero" are different
claims.
