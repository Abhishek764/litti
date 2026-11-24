# Install Litti

Litti runs on your machine (or a server) as one command. Installing takes about a minute.

## What you need

- **Node.js 22 or newer.** Check with `node --version`. Get it from [nodejs.org](https://nodejs.org).
- **Git**, for the Changes view and agent hooks.
- Windows, macOS or Linux.

## Install

```bash
npm install -g litti-cli
```

## Start it

```bash
litti
```

That's it. Your browser opens Litti's inbox, which shows a **Get started** guide. Keep this terminal open while you work; stop with `Ctrl+C`.

On the first run Litti creates a folder in your home directory:

| File | What it is |
|---|---|
| `~/.litti/config.env` | Settings, with a random `SECRET_KEY` and `LITTI_ADMIN_KEY` already filled in. Keep it private: the admin key issues review links |
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
npx litti-cli
```

For agent hooks, prefer the global install: hooks point at Litti's install folder, and `npx` may clean its cache.

## Run it with Docker (team server)

The Docker setup is for a shared team server, not for your laptop (use `npm install -g litti-cli` there). It needs a `.env` next to `docker-compose.yml`:

```bash
cp .env.example .env   # set SECRET_KEY, LITTI_API_KEY, LITTI_ADMIN_KEY and PUBLIC_URL
docker compose up -d
```

Inside the container Litti listens on `0.0.0.0`, so it refuses to start without an agent key. The port is published on `127.0.0.1` only: put your https reverse proxy or SSO proxy in front of it. Data lives in a Docker volume. Step by step: [Run Litti for your team](team-setup).

## From source (contributors)

```bash
git clone https://github.com/Abhishek764/litti.git
cd litti
npm install
npm run demo        # the demo, straight from the TypeScript source
npm test
npm run build       # compile to dist/
node dist/main.js   # the real `litti` command from your build (uses ~/.litti, or set LITTI_HOME)
```

Node 22, 24 and 26 have prebuilt SQLite drivers for Windows, macOS and Linux. If `npm install` still tries to build `better-sqlite3` from source on Windows, install the Visual Studio Build Tools with "Desktop development with C++".

## Next

[Lesson 1: your first review](first-review) shows you what a review looks like.
