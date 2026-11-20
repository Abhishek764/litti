# Install Litti

Litti runs on your machine (or a server) as one command. Installing takes about a minute.

## What you need

- **Node.js 22 or newer.** Check with `node --version`. Get it from [nodejs.org](https://nodejs.org).
- **Git**, for the Changes view and agent hooks.
- Windows, macOS or Linux.

## Install

```bash
npm install -g litti
```

## Start it

```bash
litti
```

That's it. Your browser opens Litti's inbox, which shows a **Get started** guide. Keep this terminal open while you work; stop with `Ctrl+C`.

On the first run Litti creates a folder in your home directory:

| File | What it is |
|---|---|
| `~/.litti/config.env` | Settings, with a fresh random `SECRET_KEY` already filled in |
| `~/.litti/litti.db` | Reviews, receipts and connected integrations |
| `~/.litti/deployments/` | Records of approved actions (when no deploy webhook is set) |

On Windows, `~` is `C:\Users\<you>`. Edit `config.env` and restart `litti` to change settings. See [Configuration](config) for every option.

## Useful variations

```bash
litti --no-open          # don't open the browser
litti start --port 4000  # another port
litti demo               # sample reviews to try, fresh each run
litti --version
```

## Try without installing

```bash
npx litti
```

For agent hooks, prefer the global install: hooks point at Litti's install folder, and `npx` may clean its cache.

## Run it with Docker

```bash
docker compose up -d
```

Uses the `.env` next to `docker-compose.yml` and keeps data in a Docker volume.

## From source (contributors)

```bash
git clone https://github.com/Abhishek764/litti.git
cd litti
npm install
npm run demo        # or: npm start (runs the source with tsx)
npm test
```

If `npm install` fails building the SQLite driver on Windows, install the Visual Studio Build Tools with "Desktop development with C++".

## Next

[Lesson 1: your first review](first-review) shows you what a review looks like.
