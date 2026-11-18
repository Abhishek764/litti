# Install Litti

Litti runs on your machine or a server as one Node.js process. Installing takes about two minutes.

## What you need

- **Node.js 20.10 or newer.** Check with `node --version`. Get it from [nodejs.org](https://nodejs.org) if you don't have it.
- **Git**, to download Litti and for the Changes view.
- Windows, macOS or Linux.

## Download and install

```bash
git clone https://github.com/Abhishek764/litti.git
cd litti
npm install
```

`npm install` builds the SQLite driver. If it fails on Windows, install the "Desktop development with C++" workload from the Visual Studio Build Tools and run it again.

## Check it works

Run the demo. It starts Litti with three sample actions and opens your browser:

```bash
npm run demo
```

You should see the review page at `http://127.0.0.1:3847`. Press `Ctrl+C` to stop.

## Set up your own copy

The demo is throwaway. For real use, create a settings file:

```bash
cp .env.example .env
```

Open `.env` and set **one** value: a long random `SECRET_KEY`. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then start Litti:

```bash
npm start
```

`npm start` checks your settings and refuses to start with a weak key. Leave it running in its own terminal while you work.

## Run it with Docker (optional)

```bash
docker compose up -d
```

This uses your `.env`, keeps data in a Docker volume, and restarts Litti if it stops.

## Next

[Lesson 1: your first review](first-review) shows you what a review looks like.
