# Run Litti for your team

On your laptop Litti is yours alone: it listens on 127.0.0.1 and signs you in as your OS user. On a shared server, lock it down. This checklist takes about 15 minutes.

## 1. Set the secrets

Create `.env` (copy `.env.example`) with:

```bash
# each one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SECRET_KEY=…        # signs everything, encrypts integration tokens
LITTI_API_KEY=…     # agents, CLI, pipelines (x-litti-key)
LITTI_ADMIN_KEY=…   # issues review links; never give this to an agent
PUBLIC_URL=https://litti.yourco.com   # review links point here
```

Prefer one key per agent or pipeline? Use labelled keys instead of `LITTI_API_KEY`: `LITTI_API_KEYS=ci-bot:key1,claude-ana:key2`. The label becomes the requester on every review, so an agent can't claim to be someone else.

An agent key switches Litti into team mode: typed reviewer names are refused, the local OS-user sign-in is off, and the inbox, receipts, Changes and Integrations pages need a signed-in user.

## 2. Start it

```bash
docker compose up -d
```

`docker-compose.yml` requires the `.env` file. Inside the container Litti listens on `0.0.0.0`, and Litti refuses to start on a non-loopback address without an agent key. The port is published on **127.0.0.1 only**, so nothing outside the server can reach it yet. Data lives in the `litti-data` volume (`/data/litti.db`). Back it up.

Without Docker: `npm install -g litti-cli`, put the same settings in `~/.litti/config.env`, and run `litti --no-open` on any machine with Node 22+. Keep `HOST=127.0.0.1` there too.

## 3. Put https and your login in front

Run a reverse proxy on the same host that terminates https and signs people in (oauth2-proxy, Cloudflare Access, Pomerium, an identity-aware load balancer…) and forwards to `127.0.0.1:3847`. The proxy passes each person's email in a header:

```bash
TRUST_PROXY=true
LITTI_IDENTITY_HEADER=x-forwarded-email
LITTI_ADMINS=you@yourco.com
```

> Only your proxy may reach Litti's port. Anyone who can talk to Litti directly could forge the identity header. Change the compose binding to `"3847:3847"` only if a firewall already limits who can reach it.

Reviewers now sign in once and their name is filled in and locked on every review.

## 4. Connect your team's channels

Open `https://litti.yourco.com/integrations` as an admin and follow [Lesson 4](connect-team).

## 5. Wire up deploys

Point `LITTI_DEPLOY_WEBHOOK` at your CI/CD. Litti POSTs each approved action with a signature. In the pipeline:

1. Verify `x-litti-signature` (HMAC-SHA256 of the body with `LITTI_WEBHOOK_SECRET`).
2. Call `POST /api/tokens/consume` with the token and the diff you're about to ship. Ship only on `"valid": true`; the token is used up.
3. Deploy exactly that diff.

If the webhook fails, the action is marked `deploy-failed` and nothing shipped. Fix the pipeline and retry with `POST /api/actions/:id/retry` and the admin key.

## 6. Roll out the agent hooks

On each developer's machine:

```bash
npm install -g litti-cli
litti install all --dir path/to/project
```

Then put the server's address and **that developer's agent key** (not the admin key) in `~/.litti/config.env`:

```bash
LITTI_URL=https://litti.yourco.com
LITTI_API_KEY=…
```

## 7. Check it

```bash
litti pending
litti verify
```

Then do a test review end to end, from agent to Slack to review page to deploy. Hand out personal review links with `litti review <id> --as <name>` (needs the admin key) when someone can't use SSO.
