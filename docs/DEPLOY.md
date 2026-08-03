# Putting an instance somewhere you can reach it

The Trust Operations Center reads five services over HTTP and a socket. Given
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

`deploy/Dockerfile` builds all five services and the orchestrator into one image
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

### The six values

```
node scripts/gen-deploy-secrets.mjs
```

Prints all six, shell-ready, and writes nothing to disk. Five are random
strings. The sixth is not, and the difference matters:

| | |
|---|---|
| `CAPKIT_HMAC_SECRET` | Signs capability tokens. capkit **refuses to start** without it when `NODE_ENV=production`, so a container missing it never reaches a health check. |
| `CAPKIT_ADMIN_KEY` | Mints the first token. Without it nothing can be recorded and every layer stays legitimately empty. |
| `ABSUITE_ADMIN_API_KEY` | Reads the record. 45 routes sit behind it. Without it the instance answers `/status` and returns 503 to everything else — perfectly healthy, reporting `UNKNOWN` across the board. |
| `ABSUITE_PUBLIC_PASSWORD` | The basic-auth gate. Required for any public address. |
| `CAPKIT_TRACE_PRIVATE_KEY` | Ed25519, signs execution traces. **Keep it forever and back it up.** |
| `CAPKIT_TRACE_KEY_ID` | Names the signing key in every trace. Not secret, and not optional if you ever rotate — defaults to `absuite-trace-key`. The script emits it; an earlier version of this table did not, so an operator copying six lines from the script found only five described here. |

That last one is the one that looks optional and is not. capkit runs happily
without it, signing with an ephemeral key regenerated at every start. With a
mounted volume — which both host configs below create, because records that
vanish on every deploy are not much of a demonstration — the traces outlive the
key that signed them.

Measured, not assumed. Three traces recorded, then a restart:

```
before restart   {"valid":true,  "checked":3}
after restart    {"valid":false, "determination":"FAILED", "brokenAt":1}
```

The library's diagnosis is exact — *"the content still matches its hash, so this
record was not edited; it was signed by a different key"* — so this is not a
false accusation of tampering. It is still a trust product reporting its own
record as unverifiable, on an instance whose entire purpose is to show that the
record can be verified.

`deploy/serve-all.mjs` refuses to start in that configuration rather than
letting it happen later.

### Fly

```
fly launch --no-deploy      # names the app, keeps fly.toml
fly volumes create absuite_data --size 1
node scripts/gen-deploy-secrets.mjs > secrets.env
fly secrets import < secrets.env
rm secrets.env
fly deploy
fly secrets list            # five names, no values
```

`fly.toml` sets one always-warm machine, because `auto_stop_machines` would
make the first visitor wait for a cold start and the room would look broken
while it was in fact asleep.

### Render

Connect the repository as a Blueprint. `render.yaml` declares one Docker
service with a 1GB disk at `/data`, and generates the four random secrets for
you — read them from the service's Environment tab. The trace key it cannot
generate: paste that one in from `gen-deploy-secrets.mjs`.

### Kubernetes

```
kubectl apply -f k8s/absuite.yaml
kubectl -n absuite create secret generic absuite-secrets \
  --from-env-file=<(node scripts/gen-deploy-secrets.mjs) --dry-run=client -o yaml \
  | kubectl apply -f -
```

One Deployment, one replica, one `ReadWriteOnce` volume — the shape the product
actually has. The manifests this replaced ran capkit at two replicas with an
autoscaler to ten against that same single-writer volume, which cannot work:
the volume mounts on one node, and SQLite permits one writer. ABSuite does not
scale horizontally until the storage layer does, and the manifest says so
rather than implying otherwise.

`helm-chart/` was removed in the same pass. It had no `templates/` directory,
so `helm install` created nothing, while its 265-line values file configured
autoscaling, LDAP, SIEM export and a 99.9% uptime target. It is in git history
if it is ever wanted as a starting point.

**Not applied to a cluster.** There is no `kubectl` in the environment this was
written in. Every image, variable and port was checked against `cd.yml`,
`server.ts` and `docker-compose.yml` by `pnpm check:deploy`, and the YAML
parses — but the first `kubectl apply` is the real test.

### Anywhere that runs a container

```
docker build -f deploy/Dockerfile -t absuite .
node scripts/gen-deploy-secrets.mjs > secrets.env
docker run -p 3001:3001 -v absuite-data:/data --env-file secrets.env absuite
rm secrets.env
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

Verified: 401 with no credentials, 401 with a wrong password, 200 with the
right one, and `/health` 200 either way.

Leave it unset and nothing changes — no gate, same as `pnpm room` and the same
as compose, both of which bind loopback where a password protects nobody.

Basic auth gates a demonstration instance. It is not an identity system and
does not pretend to be one. The moment this holds records that matter, replace
it with the real thing.

## What you will see

A deployed instance reports `LIVE`, `6/6 responding`, `CONNECTED`, and the
notice card is absent. The eight vertices show what `docs/CONSTITUTION.md` says
is built — three built, three partly, two not, six of them naming a file and
two naming nothing — because
`gen-architecture-layers.mjs` runs during the image build rather than trusting
whatever JSON happened to be committed.

An empty instance shows `ABSENT` where a figure would go, not zero. Nothing has
been recorded yet, and "nothing recorded" and "measured zero" are different
claims.
