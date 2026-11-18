# Run Litti for your team

On your laptop Litti is open to anyone on the machine. On a shared server, lock it down. This checklist takes about 15 minutes.

## 1. Put it on a server

```bash
cp .env.example .env
docker compose up -d
```

Or `npm start` on any machine with Node 20.10+. Data lives in `LITTI_DB_PATH` (default `data/litti.db`). Back that file up.

## 2. Set the secrets

```bash
# each one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SECRET_KEY=…        # signs everything, encrypts integration tokens
LITTI_API_KEY=…     # agents, CLI, pipelines
LITTI_ADMIN_KEY=…   # issuing review links; never give this to an agent
```

Setting `LITTI_API_KEY` switches Litti into production mode: typed reviewer names are refused, and the inbox, Changes and Integrations pages need a signed-in user.

## 3. Serve it over https behind your login

Put Litti behind your SSO proxy (oauth2-proxy, Cloudflare Access, Pomerium, an identity-aware load balancer…). The proxy signs people in and passes their email in a header:

```bash
PUBLIC_URL=https://litti.yourco.com
TRUST_PROXY=true
LITTI_IDENTITY_HEADER=x-forwarded-email
LITTI_ADMINS=you@yourco.com
```

> Only your proxy may reach Litti's port. Anyone who can talk to Litti directly could forge the identity header.

Reviewers now sign in once and their name is filled in and locked on every review.

## 4. Connect your team's channels

Open `https://litti.yourco.com/integrations` as an admin and follow [Lesson 4](connect-team).

## 5. Wire up deploys

Point `LITTI_DEPLOY_WEBHOOK` at your CI/CD. Litti POSTs each approved action with a signature. In the pipeline:

1. Verify `x-litti-signature` (HMAC-SHA256 of the body with `LITTI_WEBHOOK_SECRET`).
2. Optionally call `POST /api/tokens/verify` with the token and the diff you're about to ship.
3. Deploy exactly that diff.

## 6. Roll out the agent hooks

On each developer's machine:

```bash
npm run litti -- install all --dir path/to/project
export LITTI_URL=https://litti.yourco.com
export LITTI_API_KEY=…   # the agent key, not the admin key
```

## 7. Check it

```bash
npm run litti -- pending
npm run litti -- verify
```

Then do a test review end to end, from agent to Slack to review page to deploy.
