# Litti Connect: running the one-click Connect service

**Who this is for:** whoever publishes Litti (or a company that wants its own). End users never read this. They click **Connect**.

Slack, Discord and Atlassian only let *registered* apps connect, and Slack only sends people back to https addresses. Litti Connect is a tiny stateless web service that holds those registered apps. Every Litti install then gets one button per service: click **Connect**, pick a channel or project, click **Allow**.

```
Litti (laptop or server) ──► Litti Connect /start ──► Slack/Discord/Atlassian sign-in
          ▲                                                    │
          └──── form POST with the connection ◄── /callback ◄───┘
```

What it stores: **nothing**. The round-trip state is signed with `LITTI_BROKER_SECRET`, and tokens go straight back to the Litti that asked. It answers Jira token refreshes, because Atlassian requires the app secret for those.

It sends results back only to Litti on the same computer (`http://127.0.0.1` or `localhost`, any port), or to https origins you list in `LITTI_BROKER_ALLOWED_RETURNS`.

## 1. Deploy it (5 minutes, free)

1. In [Render](https://dashboard.render.com): **New** → **Blueprint** → choose the Litti repository. It reads `render.yaml` and creates the **litti-connect** service. `LITTI_BROKER_SECRET` is generated for you.
2. When it's live, copy its URL, for example `https://litti-connect.onrender.com`.
3. In the service's **Environment**, set `LITTI_BROKER_URL` to that URL. Leave the app variables for now.

Any Node 20+ host works the same way: `npm ci && npm run build`, then `node dist/broker/server.js` with the environment variables below.

## 2. Register the three apps (once)

Replace `https://litti-connect.onrender.com` with your URL.

### Slack

1. https://api.slack.com/apps → **Create New App** → **From scratch** → name `Litti`, pick your workspace.
2. **OAuth & Permissions**:
   - **Redirect URLs** → add `https://litti-connect.onrender.com/callback/slack` → **Save URLs**.
   - **Bot Token Scopes** → add `chat:write` and `incoming-webhook`.
3. **Manage Distribution** → complete the checklist → **Activate Public Distribution**. Without this, only your own workspace can connect.
4. **Basic Information** → copy **Client ID** and **Client Secret** into `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.

### Discord

1. https://discord.com/developers/applications → **New Application** → `Litti`.
2. **OAuth2** → **Redirects** → add `https://litti-connect.onrender.com/callback/discord` → **Save Changes**.
3. Same page: copy **Client ID**, click **Reset Secret** and copy it, into `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.

Litti only asks Discord for an incoming webhook. No bot is added to anyone's server.

### Jira (Atlassian)

1. https://developer.atlassian.com/console/myapps/ → **Create** → **OAuth 2.0 integration** → `Litti`.
2. **Permissions** → **Jira API** → **Add** → **Configure** → **Edit Scopes** → `read:jira-work`, `write:jira-work`, `read:jira-user`.
3. **Authorization** → **OAuth 2.0 (3LO)** → Callback URL `https://litti-connect.onrender.com/callback/jira`.
4. **Distribution** → **Edit** → **Sharing**, and fill in the vendor and privacy fields. Without this, only your own Atlassian account can connect.
5. **Settings** → copy **Client ID** and **Secret** into `ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET`.

Save the environment. Render restarts the service. Open its URL: the page lists Slack, Discord and Jira as **✅ ready**.

## 3. Point Litti at it

For everyone who installs Litti, set the default in `src/connect/routes.ts`:

```ts
export const DEFAULT_BROKER = 'https://litti-connect.onrender.com';
```

and publish a new version. Or, for one install, add to `~/.litti/config.env`:

```bash
LITTI_CONNECT_BROKER=https://litti-connect.onrender.com
```

`LITTI_CONNECT_BROKER=off` turns one-click off.

## Team servers

A company running Litti at `https://litti.acme.com` can use the public service by asking the operator to add that origin to `LITTI_BROKER_ALLOWED_RETURNS`. Or it can run its own Litti Connect with its own apps; or skip it and use "Other ways to connect" on the Integrations page.

## Environment variables

| Variable | Purpose |
|---|---|
| `LITTI_BROKER_URL` | This service's public https URL (used to build provider redirect URLs) |
| `LITTI_BROKER_SECRET` | 32+ random characters; signs the round-trip state |
| `LITTI_BROKER_ALLOWED_RETURNS` | Extra https origins allowed to receive results, comma-separated |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack app |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord app |
| `ATLASSIAN_CLIENT_ID` / `ATLASSIAN_CLIENT_SECRET` | Atlassian app |
| `PORT` | Set by the host |
