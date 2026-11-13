# Outpost Zero — corrected project files

## Files

- `index.html` — page structure.
- `style.css` — responsive styling and accessibility states.
- `script.js` — game engine, interface, mission logic and API client.
- `worker.js` — Cloudflare Worker API for moderation and the shared leaderboard.
- `schema.sql` — D1 tables and indexes.
- `wrangler.toml` — Cloudflare Worker configuration template.

## 1. Put the frontend files together

Put `index.html`, `style.css` and `script.js` in the same website folder. The HTML already links to the other two files.

The frontend is configured to call:

`https://outpost-moderator.ramneek-space.workers.dev`

Change `API_BASE` near the top of `script.js` only if your Worker has a different URL.

Do not test the leaderboard from a `file://` address. Serve the page using a local development server or deploy it to a website. The Worker uses an exact origin allowlist; CORS is not configured as `*`.

## 2. Create the D1 database

Install/use Wrangler and sign in to Cloudflare, then run:

```bash
npx wrangler login
npx wrangler d1 create outpost-zero
```

Cloudflare prints a database ID. Copy that ID into `wrangler.toml`, replacing:

`REPLACE_WITH_YOUR_D1_DATABASE_ID`

Keep `binding = "DB"` exactly as written because the Worker reads `env.DB`.

## 3. Initialize the database

From the folder containing `wrangler.toml` and `schema.sql`, run:

```bash
npx wrangler d1 execute outpost-zero --remote --file=./schema.sql
```

For local Worker testing, initialize the local database too:

```bash
npx wrangler d1 execute outpost-zero --local --file=./schema.sql
```

## 4. Add the Gemini API key as a Cloudflare secret

Run:

```bash
npx wrangler secret put GEMINI_API_KEY
```

Paste the key into Wrangler's secure prompt. Do not put the key in `script.js`, `index.html`, `style.css`, `wrangler.toml`, or a public repository.

The Worker defaults to the `gemini-3.8-flash` model. You can change `GEMINI_MODEL` in the Worker's variables if you choose another currently supported model.

## 5. Configure the website origin

In `wrangler.toml`, replace `https://YOUR-SITE.pages.dev` with the exact deployed website origin. Do not add a trailing slash. Keep the localhost values only if you need local development.

For example:

`ALLOWED_ORIGINS = "https://outpost-zero.pages.dev,http://localhost:5500,http://127.0.0.1:5500"`

Deploy the Worker after changing the configuration:

```bash
npx wrangler deploy
```

If you already have a Worker with the current URL, use its existing Worker name/configuration or deploy this code to that same Worker. Do not accidentally create a different Worker and leave `API_BASE` pointing at the old one.

## 6. Check the API

Open this URL in a browser:

`https://outpost-moderator.ramneek-space.workers.dev/api/health`

It should return JSON with `ok`, `databaseConfigured` and `moderationConfigured` set to `true`.

Then open the game from its hosted website. The leaderboard starts empty; it no longer displays invented example scores or saves a fake “global” list in each browser.

## Important limits and privacy

- A callsign must use 2–20 English letters, numbers, underscores or hyphens. The Worker also asks Gemini to moderate it. Automated moderation is not perfect.
- Do not use a real name or include a school, address, phone number, email, social-media handle or other personal information in a callsign.
- The leaderboard stores the callsign, world, mission turns, science, radiation meter value, score and timestamp. The rate-limit table temporarily stores a SHA-256 hash of the connecting IP address to reduce spam; old rate-limit entries are cleaned up as later requests arrive. Do not collect personal details for this game.
- The Worker calculates the score on the server, but the browser still sends the mission statistics. A technically skilled player could alter those values before submission. This is a casual leaderboard, not a cheat-proof esports ranking. A fully authoritative system would need the server to simulate or independently verify every mission action.
- The 100 mSv loss threshold, solar-cycle timetable, module outputs, power-unit output, shield percentages, upgrade prices and random events are simplified game rules, not official NASA limits or equipment specifications.
- Outpost Zero is an independent educational game and is not an official NASA product or mission simulator.
