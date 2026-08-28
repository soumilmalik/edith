# EDITH — Personal Life Manager

A Jarvis/EDITH-style assistant: full-screen blue-on-black UI with a cursor/voice-reactive
3D orb and clock, chat + voice conversation backed by Claude, Google Calendar CRUD with
priority-based conflict resolution, life goals (decade/year/month/week), health tracking
(water/calories/gym), timers/reminders/stopwatch, editable life domains, and schedule
upload (image/PDF) parsing.

```
/app       React + Vite frontend  -> deployed to GitHub Pages (static)
/worker    Cloudflare Worker      -> proxies the Anthropic API key, verifies your login
firestore.rules  Security rules for the Firestore database
```

The frontend never holds the Anthropic API key. The Worker never touches your Google
Calendar token or your Firestore data — it only relays chat turns to Claude. Access is
gated by Firebase Google Sign-In restricted to **your** email, enforced both client-side
and in Firestore rules and the Worker's JWT check — that's the "password."

## 1. Google Cloud (Calendar API + OAuth client)

1. Go to console.cloud.google.com, create a project (or reuse one).
2. APIs & Services > Library > enable **Google Calendar API**.
3. APIs & Services > Credentials > Create Credentials > OAuth client ID > **Web application**.
   - Authorized JavaScript origins: `http://localhost:5173` (dev) and your GitHub Pages
     origin, e.g. `https://<username>.github.io`.
   - Copy the Client ID → `VITE_GOOGLE_CLIENT_ID`.
4. OAuth consent screen: add your own Google account as a **test user** (or publish the
   app; test mode is fine for personal use, tokens just need re-consent occasionally).

## 2. Firebase (Auth + Firestore)

1. Go to console.firebase.google.com, create a project.
2. Build > Authentication > Sign-in method > enable **Google**.
3. Build > Firestore Database > create database (production mode).
4. Deploy `firestore.rules` (Firebase Console > Firestore > Rules tab, paste the file's
   contents, or use the Firebase CLI: `firebase deploy --only firestore:rules`).
5. Project settings > General > Your apps > Web app > copy the config into the
   `VITE_FIREBASE_*` variables.
6. Project settings > General > note the **Project ID** — used as `FIREBASE_PROJECT_ID`
   in the Worker.

## 3. Anthropic API key

Get a key at console.anthropic.com. This powers Edith's brain (chat + tool-calling) and
the document/image extraction for uploaded schedules.

## 4. Cloudflare Worker (backend)

```bash
cd worker
npm install
npx wrangler login
# Edit wrangler.toml: set FIREBASE_PROJECT_ID and ALLOWED_ORIGIN to your real values
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy
```

This prints your Worker URL (e.g. `https://edith-worker.<you>.workers.dev`) — that's
`VITE_WORKER_URL`.

For local development: `npm run dev` runs it at `http://localhost:8787`.

## 5. Frontend

```bash
cd app
npm install
cp .env.example .env.local   # fill in all the values gathered above
npm run dev                  # http://localhost:5173
```

## 6. Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Repo Settings > Pages > Source: **GitHub Actions**.
3. Repo Settings > Secrets and variables > Actions > add each of these as a secret
   (same names/values as your `.env.local`):
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
   `VITE_FIREBASE_APP_ID`, `VITE_GOOGLE_CLIENT_ID`, `VITE_ALLOWED_EMAIL`,
   `VITE_WORKER_URL`.
4. Push to `main` — the workflow in `.github/workflows/deploy.yml` builds and deploys
   automatically. Your site will be at `https://<username>.github.io/<repo>/`.
5. Open it on your phone and use "Add to Home Screen" for an app-like icon (it's a PWA).

## Notes & limitations (v1)

- **Voice** uses the browser's built-in speech recognition/synthesis (free, no backend
  call). Quality varies by browser — Chrome has the best support. Safari/iOS support for
  SpeechRecognition is limited; typing still works everywhere.
- **Reminders** fire while the app is open or backgrounded in the browser/installed PWA.
  True push notifications while the app is fully closed would need a push server and
  isn't included — flag it if you want it added later.
- Calendar conflict resolution is handled by Claude reasoning over your events and
  priorities in conversation, not silent automatic rescheduling — it will always ask
  before deleting or overwriting anything.
- Life domains (Health, Academics, Business/Money, Extracurriculars) are editable any
  time in the Domains panel.
