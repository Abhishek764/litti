# Setting up Switch for Litti: a real-world walkthrough

This guide takes you from a fresh Switch Console install to a real team workflow: a coding agent
in a Discord channel asks `@litti` for permission, teammates review, and the action runs only
after they pass. About **20 minutes** the first time.

```
 Discord channel  ←→  Switch room
   ├─ you + teammates          (reviewers)
   ├─ @your-coding-agent       (does the work, must ask first)
   └─ @litti                   (approval gate — this repo)
```

> Using Slack, Teams or Telegram instead? Everything is the same except step 2. Follow Switch's
> guide for your app: [Connect a messaging app](https://docs.switchagents.ai/switch-rooms/deploy/messaging-apps/index).

---

## 0. Before you start

- **Switch Console** installed and running with **"Set up a server on this computer"**.
  Check that it's up:
  ```bash
  curl http://127.0.0.1:64300/health      # → {"status":"ok"}
  ```
- **Node.js 20.10+** and this repo installed: `npm install`.
- A **Discord server** where you can add a bot and manage channels.
- A **coding agent** set up as a provider in Switch Console (any one Switch supports, e.g. Codex, Cursor, OpenCode, Antigravity). See
  [Set up agent providers](https://docs.switchagents.ai/switch-rooms/getting-started/set-up-agent-providers).

---

## 1. Create the Discord bot (5 min)

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → name it `Agent Switch`.
2. **Bot** tab → copy the **bot token** (reset it if hidden). Keep it in a password manager.
3. Still on **Bot**, under **Privileged Gateway Intents**, turn on:
   - **Server Members Intent**
   - **Message Content Intent**. Without it, agents receive empty messages.

   Click **Save Changes**.
4. **OAuth2 → URL Generator**:
   - Scopes: `bot` **and** `applications.commands`
   - Bot permissions: View Channels, Send Messages, Send Messages in Threads, **Manage Webhooks**,
     Manage Channels, Manage Roles, Read Message History, Attach Files
5. Open the generated URL and add the bot to your Discord server.
6. In Discord: **User Settings → Advanced → Developer Mode** on. Right-click your server icon →
   **Copy Server ID**. This is the "Guild Id".

## 2. Connect Discord to Switch (2 min)

1. In **Switch Console**, select your local server → **Home** → **Messaging apps** → **Connect** → **Discord**.
2. **Name:** your Discord server's name. Paste the **Bot Token** and **Guild Id** → **Connect**.
3. When asked which Discord account is yours, find yourself → **This is me**.
   Don't skip this, or agents may treat you as a stranger.

✅ Discord shows under **Messaging apps** with no error.

## 3. Create the room (1 min)

1. In Discord, create a channel, e.g. `#ship-room`.
2. **Post any normal message in it** (e.g. "hello"). Posting is what creates the room.
   A `!` or `/` command as the very first message does nothing.

✅ `#ship-room` appears under **Your Rooms** in Switch Console.

**Room instructions (recommended):** in Switch Console open the room → **Instructions**, and paste:

```
This room ships code. Before any migration, deploy, delete, or change to auth,
security, secrets or production config, ask @litti for approval with
"@litti propose" and wait until "@litti status <id>" says APPROVED.
Never approve your own actions.
```

## 4. Register Litti as a Switch agent (2 min)

1. **Switch Console → Settings → API keys → Create Registration Key**. Copy it.
2. In this repo, open `.env`. It was created for you with a `SECRET_KEY`. If it's missing, run
   `cp .env.example .env` and set `SECRET_KEY` to a long random string. Then set:
   ```bash
   SWITCH_API_URL=http://127.0.0.1:64300
   SWITCH_REGISTRATION_KEY=<paste the key>
   ```
3. Start Litti:
   ```bash
   npm run demo      # hackathon/demo: 3 sample actions, typed reviewer names allowed
   # or
   npm start         # production mode: strict reviewer identity
   ```
   On the first run you should see:
   ```
   🔑 Registered "litti" as a Switch agent (credentials saved to .litti-switch.json).
   🔑 Connected to Switch as @litti · ...
   ```
   Litti saves its own credentials, so the registration key is only needed once. You can delete it from `.env` afterwards.

✅ `litti` appears under **Your Agents** in Switch Console.

## 5. Invite Litti into the room (30 sec)

In `#ship-room`, send:

```
!invite-agent @litti
```

Then:

```
@litti help
```

Litti replies with its command list. Keep the terminal running. Litti only answers while
`npm run demo` / `npm start` is running.

> Discord won't autocomplete `@litti` and shows it as plain text. It still works.
> Don't end a sentence with `@litti.` (a period breaks the mention).

## 6. Add your coding agent to the room (3 min)

1. **Switch Console → Your Agents → +** (the dashed card).
2. **Run location:** this computer. **Provider:** your coding agent.
3. **Working directory:** the repo the agent should work in. To try it safely, use
   `demo/sample-repo` from this project.
4. **Name:** e.g. `builder.ship-room.<yourname>` (lowercase, digits, `.`, `-`, `_`).
   **Description:** "Builds features in ship-room; asks @litti before risky actions."
5. **Agent instructions:** paste the contents of [agent-instructions.md](agent-instructions.md).
6. **Who can talk to your agent:** *Only me* is fine to start. Use *Anyone* if teammates will direct it.
7. Create it. Then, in `#ship-room`:
   ```
   !invite-agent @builder.ship-room.<yourname>
   ```

✅ The room now has you, your coding agent, and `@litti`.

## 7. Let teammates review (optional, needed for real Tier 2/3)

Tier 2 needs **2 different reviewers** and Tier 3 needs **3**, and the requester can never review its own action.

- **Teammates** join the Discord channel, then in Switch Console's **Messaging apps** they link their Discord account.
- **Review links on other computers:** by default links point to `http://127.0.0.1:3847`, which only works
  on your machine. To share them, expose port 3847 with a tunnel (e.g. `cloudflared tunnel --url http://localhost:3847`)
  and set in `.env`:
  ```bash
  PUBLIC_URL=https://<your-tunnel-address>
  ```
- **Solo testing:** use `npm run demo`, where you can type any reviewer name (`priya`, `sam`) on the review page.

---

## 8. Real-world scenarios to run

### A. The agent asks before a migration (happy path)

In `#ship-room`, ask your coding agent:

```
@builder.ship-room.<yourname> add an mfa_enabled boolean column to the users table in
demo/sample-repo/migrations. It's a migration, so get approval from @litti first.
```

What should happen:

1. The agent posts `@litti propose` with a JSON block.
   **Litti replies:** `🔒 Approval needed — 🟠 Tier 2 · 2 reviewers` and the reasons.
2. Each reviewer sends `@litti review <id>` and gets a **personal signed link**.
3. On the page: read the diff, answer the quiz ("Which table does this migration alter?" → `users`),
   tick the box, wait at least 30s, then **Countersign**.
4. The room shows `✍️ priya countersigned (1/2)`, then `✅ Deploy executed — reviewed by priya, sam`.
5. The agent checks `@litti status <id>`, sees **APPROVED**, and applies exactly the approved change.

> If your agent doesn't propose on its own, propose for it so you can see the flow:
> ````
> @litti propose
> ```json
> {"action":"migrate","description":"Add mfa_enabled to users","diff":"+ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;","touchedPaths":["migrations/002_add_mfa.sql"],"reversible":true,"rollbackPlan":"Remove the mfa_enabled column."}
> ```
> ````

### B. Someone rubber-stamps

1. Open a review link, pick a wrong answer and click **Countersign** within a few seconds.
2. The room shows: `⚠️ @sam Comprehension quiz failed. Blocked. All reviews reset, and the next action's tier is bumped +1.`
3. `@litti stats` shows that reviewer's low attention score and rubber-stamp count.

### C. Nobody can approve from chat

```
@litti approve
```

Litti replies: `🔒 Nice try. Litti doesn't take approvals in chat...`

### D. A dangerous action gets the highest tier

````
@litti propose
```json
{"action":"delete","description":"Drop the legacy_tokens table","diff":"+DROP TABLE legacy_tokens;","touchedPaths":["migrations/009_drop_legacy.sql"],"reversible":false}
```
````

Litti replies with **🔴 Tier 3 · 3 reviewers** (destructive, irreversible).

### E. Someone edits history

1. Open `http://127.0.0.1:3847/dashboard.html` → **Break Chain (Demo)**. This only works in `npm run demo`.
2. In the room: `@litti verify` → `❌ Chain broken at receipt #N`.

### F. The agent changes the diff after approval

The approval token is bound to the diff's SHA-256. A pipeline (or you) can check it:

```bash
curl -s http://127.0.0.1:3847/api/actions/<id>            # copy "token"
curl -s -X POST http://127.0.0.1:3847/api/tokens/verify \
  -H "content-type: application/json" \
  -d '{"token": <token>, "diff": "<the exact approved diff>"}'     # → valid: true
# change one character in "diff" and run it again               # → valid: false, "Diff changed since approval"
```

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `Switch is not reachable at http://127.0.0.1:64300` | Open Switch Console; the local server must be running. Check `curl http://127.0.0.1:64300/health`. |
| `First run needs SWITCH_REGISTRATION_KEY` | Add the key from **Settings → API keys** to `.env` (step 4). |
| `Switch registration failed (401)` | Wrong or deleted key. Create a new registration key. |
| `@litti` doesn't answer | Is the Litti terminal still running? Was `!invite-agent @litti` sent in this channel? Is it spelled `@litti` with no period after it? |
| `!invite-agent` does nothing | The channel isn't a room yet. Post a normal message first, then retry. |
| Agents get empty messages / don't react | **Message Content Intent** is off in the Discord Developer Portal (step 1.3). |
| No `/` commands in Discord | Re-invite the bot with both `bot` and `applications.commands` scopes. |
| Agent says it can't tell if you're its owner | Link your Discord account: Switch Console → **Messaging apps** → **Link my account…** |
| Review page: "Reviewer identity required" | Production mode. Get your link with `@litti review <id>`, or use `npm run demo`. |
| Review page: "needs at least 30s" | Tier 2+ requires 30s of real reading. The server measures this time itself. |
| Teammates can't open review links | Set `PUBLIC_URL` to a tunnel address (step 7). |
| `EADDRINUSE 127.0.0.1:3847` | Another Litti is still running. Stop it or set `APPROVAL_SERVER_PORT`. |
| Start over with a fresh Litti agent | Delete `.litti-switch.json` and run again with a registration key. Litti re-registers itself. |

---

## Checklist

- [ ] `curl http://127.0.0.1:64300/health` returns ok
- [ ] Discord connected under **Messaging apps**, account linked
- [ ] `#ship-room` listed under **Your Rooms**
- [ ] `SWITCH_REGISTRATION_KEY` in `.env`, `npm run demo` prints "Connected to Switch as @litti"
- [ ] `!invite-agent @litti` then `@litti help` answers in the channel
- [ ] Coding agent onboarded with [agent-instructions.md](agent-instructions.md) and invited
- [ ] Scenario A completes with `✅ Deploy executed` in the room
