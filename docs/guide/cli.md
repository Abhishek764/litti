# CLI reference

Run `litti` with no command to start the server. Every other command talks to a running Litti server, from any folder.

It finds the server through `LITTI_URL` (default `http://127.0.0.1:3847`) and sends `LITTI_API_KEY` / `LITTI_ADMIN_KEY` from your environment or `~/.litti/config.env`.

## Run Litti

| Command | What it does |
|---|---|
| `litti [start] [--port N] [--no-open]` | Start Litti and open the inbox in your browser (default port 3847) |
| `litti demo [--port N] [--no-open]` | Try it with sample reviews (fresh demo data each run) |
| `litti --version` | Print the version |
| `litti help` · `--help` · `-h` | Print this list and exit. Never starts the server |

`--port=N` works too. A bare `--port`, a port outside 1–65535 or an unknown option prints an error and the help, and nothing starts. If the port is busy (say, Litti is already running), Litti tells you and suggests another port.

## Review flow

| Command | What it does |
|---|---|
| `propose <file.json \| ->` | Ask for approval. JSON fields: `action`, `description`, `diff`, `touchedPaths[]`, optional `agent`, `reversible`, `rollbackPlan` |
| `status <id>` | Approved yet? Prints the signed token once approved |
| `pending` | Actions waiting for reviewers |
| `review <id> --as <name>` | Personal, signed review link for one reviewer (valid 30 minutes). Needs the admin key if one is set |

```bash
echo '{"action":"migrate","description":"Add index","diff":"+CREATE INDEX i ON users(email);","touchedPaths":["migrations/9.sql"]}' \
  | litti propose -
```

## Changes and notes

| Command | What it does |
|---|---|
| `notes [--all]` | Open review notes on the working-tree diff (all notes with `--all`) |
| `reply <note-id> <text…>` | Answer a note as the agent |
| `resolve <note-id>` | Close a thread once it's handled |
| `submit [description…]` | Send the current working-tree diff for review |

## Agents

| Command | What it does |
|---|---|
| `install <claude\|codex\|opencode\|all> [--dir <project>] [--global]` | Install the hook that blocks risky commands until reviewed. From your home folder it needs `--global` (that gates every project) |

## Evidence

| Command | What it does |
|---|---|
| `verify` | Check the receipt chain for tampering. Exits with code 2 if broken |
| `stats` | Each reviewer's average attention, rubber-stamps and approval rate |

## Exit codes

`0` success · `1` error (message on stderr) · `2` receipt chain broken.
