Outpost Zero
Lunar & Martian Habitat Operations is an independent educational browser game about operating a simulated habitat on the Moon or Mars.

Outpost Zero is not an official NASA product, mission, or engineering tool. Its resource rates, equipment performance, mission thresholds, environmental cycles, and random events are simplified game parameters rather than official NASA specifications.
Project files
The website frontend consists of:

- index.html — page structure and interface elements.
- style.css — responsive styling and visual states.
- script.js — mission simulation, interface behavior, sound effects, and API client.
  The Cloudflare backend is maintained separately and may include:
- worker.js — Worker API.
- schema.sql — D1 database schema.
- wrangler.toml — Wrangler configuration.
  Keep the three frontend files in the same folder. The HTML loads style.css and script.js by relative path.
  Run the frontend locally
  Do not open the page directly using a file:// URL. Use a local web server instead.

From the folder containing index.html, run:
py -m http.server 5500
Then open:
http://localhost:5500
If the py command is unavailable, try:
python -m http.server 5500
Backend connection
The frontend currently sends requests to this Cloudflare Worker:
https://outpost-moderator.ramneek-space.workers.dev
The base URL is configured by API_BASE near the top of script.js. Change it only when the deployed Worker URL changes.

The frontend expects these API routes:
Method Route Purpose
POST /api/scores Submit a completed mission record.
GET /api/leaderboard?world=all Retrieve all leaderboard records.
GET /api/leaderboard?world=moon Retrieve Moon records.
GET /api/leaderboard?world=mars Retrieve Mars records.

The website origin must be allowed by the Worker’s CORS/origin configuration. For the current GitHub Pages site, the origin is:
https://ramneekisgod.github.io
An origin contains the scheme and host only; it does not include the repository path or a trailing slash. For local development, allow the exact local origin you use, such as http://localhost:5500.

Backend bindings, secrets, database initialization, moderation provider, and deployment commands must match the actual worker.js, schema.sql, and wrangler.toml in the backend project. Do not add guessed secret names or change the deployed Worker configuration based only on this frontend README.
Leaderboard and callsign privacy
The game asks players to submit a callsign rather than a real name. The frontend accepts 2–20 characters consisting of English letters, numbers, underscores, and hyphens.

Use a made-up callsign. Do not include a real name, school, home address, precise location, phone number, email address, social-media handle, or other personal information.

The frontend sends the callsign, selected world, mission day count, science total, radiation total, and win/loss result to the Worker. The backend determines what is stored, how it is moderated, and how long it is retained; check the backend implementation and its privacy settings before publishing or changing those behaviors.

Automated moderation can make mistakes and is not a guarantee that every unsuitable callsign will be blocked.

The browser supplies mission statistics to the API. Unless the backend independently verifies or re-simulates mission actions, a technically capable player could alter the submitted values. Treat the leaderboard as a casual game feature, not a cheat-proof competitive ranking.
Mission model notes
Outpost Zero uses simplified planning values for gameplay, including:

- a 60-day mission duration;
- modeled oxygen and food consumption;
- solar generation and battery storage;
- configurable habitat systems and upgrades;
- simplified radiation and storm events; and
- a modeled mission-performance score.
  These values are not operational guidance. Real spacecraft and surface habitats require engineering analysis, verified life-support systems, mission-specific radiation assessment, and extensive safety procedures.
  Updating the website
  After changing frontend files, save them and commit the changes from the website repository:
  git add index.html style.css script.js README.md LICENSE
  git commit -m "Update Outpost Zero"
  git push origin main
  The hosted GitHub Pages site updates from the repository’s configured publishing branch. After the push completes, refresh the site with Ctrl + Shift + R to bypass the browser cache.
  Licence
  This project is released under the MIT License. See LICENSE for the licence text.
