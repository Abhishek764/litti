# Lesson 4: tell your team in Slack, Discord or Jira

Open `http://127.0.0.1:3847/integrations`. Each service has a **Connect** button. Pick the fastest path below.

Whatever you connect, nobody can approve from chat or a ticket. Every message links to the review page, where the check runs. Only metadata is sent: description, file names, risk reasons and the diff's hash. Your code stays on your server.

## Discord: one minute

1. In Discord, open the channel settings (⚙️) → **Integrations** → **Webhooks** → **New Webhook**.
2. Click the new webhook → **Copy Webhook URL**.
3. On the Integrations page, paste it under **Paste a Discord webhook link** → **Connect**.
4. Click **Send test**. A message appears in the channel.

## Slack

### Fastest: paste a link

1. Open [Slack apps](https://api.slack.com/apps?new_app=1) → **Create New App** → **From scratch**, name it Litti, pick your workspace.
2. **Incoming Webhooks** → turn it on → **Add New Webhook to Workspace** → pick a channel → **Allow**.
3. Copy the webhook URL, paste it on the Integrations page → **Connect** → **Send test**.

### Best: the Slack app

This adds threads and live updates: replies go under the original card, and the card changes when the action is approved.

1. On the Integrations page, click **Create Litti app in Slack**. Slack opens with everything filled in. Pick your workspace → **Next** → **Create**.
2. On the app's **Basic Information** page, copy **Client ID** and **Client Secret** into the form on the Integrations page → **Save**.
3. Click **Connect Slack**, choose the channel, **Allow**. You're back on Litti, connected.

Slack only redirects to **https** addresses. If Litti runs on plain `http://localhost`, use the paste-a-link option, or run Litti behind https and set `PUBLIC_URL`.

## Jira

Jira needs a one-time app setup. It takes about two minutes, and the Integrations page shows each value with a **Copy** button.

1. Open the [Atlassian developer console](https://developer.atlassian.com/console/myapps/) → **Create** → **OAuth 2.0 integration** → name it Litti.
2. **Permissions** → **Jira API** → **Add** → **Configure** → **Edit Scopes** → tick `read:jira-work`, `write:jira-work`, `read:jira-user` → **Save**.
3. **Authorization** → **OAuth 2.0 (3LO)** → **Configure** → paste the **Callback URL** from the Integrations page → **Save changes**.
4. **Settings** → copy **Client ID** and **Secret** into the form on the Integrations page → **Save**.
5. Click **Connect Jira**, sign in, accept, and you're back.
6. Pick the **project** for issues and how risky an action must be to get one (default: Tier 2 and up). Optionally name the status to move issues to when approved, such as `Done`. Click **Save**, then **Send test**.

Each risky action becomes an issue labelled `litti` and `litti-tier-N`. Every review step is a comment. Litti keeps the Jira sign-in fresh by itself.

## In production

On a shared server, only admins can change integrations. List them by their SSO identity:

```bash
LITTI_IDENTITY_HEADER=x-forwarded-email
LITTI_ADMINS=you@yourco.com,lead@yourco.com
```

Tokens are stored encrypted with your `SECRET_KEY`. If you change `SECRET_KEY`, connect again.

Prefer configuration files? Every integration can also be set with environment variables. See [Configuration](config).

## Next

You've finished the lessons. Read [Run Litti for your team](team-setup) when you're ready to share it.
