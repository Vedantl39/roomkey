# Roomkey

[![CI](https://github.com/Vedantl39/roomkey/actions/workflows/ci.yml/badge.svg)](https://github.com/Vedantl39/roomkey/actions/workflows/ci.yml) [![Deploy](https://github.com/Vedantl39/roomkey/actions/workflows/deploy.yml/badge.svg)](https://github.com/Vedantl39/roomkey/actions/workflows/deploy.yml) [![Weekly report](https://github.com/Vedantl39/roomkey/actions/workflows/weekly-report.yml/badge.svg)](reports/README.md)

**Live:** https://roomkey-dublin.netlify.app
<img width="1918" height="958" alt="Screenshot 2026-09-30 at 5 58 45 PM" src="https://github.com/user-attachments/assets/97bb7d55-aa87-4832-b2f1-8489192fe517" />

One QR for the whole room. A presenter pastes links, API keys and commands into a notepad, and they show up live on every attendee's laptop (Windows, Mac or phone), behind a 6-digit room PIN.

- **Presenter:** start a room, show the QR, code and PIN on the projector, and paste. Changes reach every laptop in about half a second.
- **Attendees:** scan, type the PIN, and copy any line with one click. An "I'm stuck" button shows the presenter a live count of who needs help.
- **Privacy:** notes are encrypted in the browser with a key made from the PIN (AES-256-GCM, PBKDF2) before they're sent. The database only ever stores scrambled text.

It's a plain static site (HTML, CSS, JS) with Firebase Realtime Database for the live sync. No build step.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `app.js` | All the app logic |
| `styles.css` | The look |
| `firebase-config.js` | **You edit this one** with your Firebase keys |
| `database.rules.json` | Security rules (deployed automatically, see below) |
| `agent/` | The insights agent that writes the weekly usage report |
| `reports/` | The latest weekly report, plus an archive in `reports/weekly/` |
| `tests/` | Database rules tests (Firebase emulator) and an end-to-end browser test |
| `.github/workflows/` | CI, deploy and weekly report pipelines |

## Setup (about 10 minutes)

### 1. Create the Firebase project
1. Go to https://console.firebase.google.com and click **Create a project**. Name it `roomkey`. You can switch Google Analytics off. Click **Create project**.

### 2. Turn on anonymous sign-in
2. In the left menu: **Build > Authentication > Get started**.
3. Open the **Sign-in method** tab, click **Anonymous**, switch it on, and **Save**.
   (Nobody has to sign up. This just gives each browser an ID so only the presenter can edit their room.)

### 3. Create the database
4. **Build > Realtime Database > Create database**. Pick **Belgium (europe-west1)**, choose **Start in locked mode**, then **Enable**.
5. Open the **Rules** tab, delete what's there, paste everything from `database.rules.json`, and click **Publish**.

### 4. Get your config
6. Click the gear icon next to Project Overview, then **Project settings**.
7. Under **Your apps**, click the web icon `</>`. Name it `roomkey`, leave Hosting unticked, and click **Register app**.
8. You'll see a `firebaseConfig = { ... }` block. Copy the values into `firebase-config.js` so it looks like this:

```js
window.ROOMKEY_FIREBASE = {
  apiKey: "AIza...",
  authDomain: "roomkey-xxxx.firebaseapp.com",
  databaseURL: "https://roomkey-xxxx-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "roomkey-xxxx",
  appId: "1:1234:web:abcd"
};
```

Make sure `databaseURL` is there. If it's missing, copy it from the top of the Realtime Database page.

### 5. Put it online
Easiest: **Netlify Drop**.
1. Go to https://app.netlify.com/drop
2. Drag the whole `roomkey-site` folder onto the page.
3. Sign up (free) when asked so the site stays up. You get a link like `https://something.netlify.app`. Rename it under **Site configuration > Change site name** (e.g. `roomkey-dublin.netlify.app`).

Alternatives: GitHub Pages (upload the files to a repo, then **Settings > Pages > Deploy from branch**), or Vercel.

### 6. Allow your domain
In Firebase: **Authentication > Settings > Authorized domains > Add domain**, and add your site's domain (e.g. `roomkey-dublin.netlify.app`).

### 7. Try it
Open your site on your laptop, click **Start a room**, then open the same site on your phone and join with the code and PIN. Type on the laptop and watch the phone.

## Good to know

- **Free plan limits:** Firebase's free plan allows 100 people connected at the same time and plenty of data for text notes. Fine for most workshops. Bigger events need the pay-as-you-go plan, which costs cents at this size.
- **It needs https.** Browsers only allow the encryption on secure pages. Netlify, GitHub Pages and Vercel all give you https automatically. Opening `index.html` straight from your folder won't work.
- **The PIN stops casual snooping, not a determined attacker.** Anyone with the link and no PIN sees nothing readable. But a 6-digit PIN could be brute-forced offline by someone who really tries. For real API keys, use workshop-only keys and revoke them after the session.
- **Presenter on a new laptop:** your room is tied to the browser you created it in. Open the room link in that browser to keep editing. On a different browser you'll see it as an attendee.
- **Closing a room** wipes the notes for everyone.

## How it works

```
Presenter's browser                     Firebase                     Attendee's browser
type notes ──► encrypt with PIN ──► rooms/CODE/pad (scrambled) ──► decrypt with PIN ──► show + copy
                                    rooms/CODE/meta (name, salt, PIN check, owner id)
                                    rooms/CODE/people/ID ◄── "I'm stuck"
```

The database rules make sure only the room's creator can change its notes, each attendee can only write their own "stuck" flag, and nobody can list all rooms.

## Usage analytics

Roomkey counts how it's being used so you can see whether it's working in real rooms. **It only ever records events, never content.** Each event is five fields:

| Field | Example | Meaning |
|---|---|---|
| `t` | `joined` | What happened |
| `r` | `K7PQ2M` | Which room |
| `u` | anonymous ID | Which browser (Firebase anonymous sign-in, no name or email) |
| `d` | `d` or `m` | Laptop/desktop or phone |
| `at` | server time | When |

Events tracked: `room_created`, `joined`, `pin_failed`, `stuck_on`, `stuck_off`, `copy_line`, `copy_section`, `copy_all`, `link_copied`, `projector_opened`, `room_closed`, `room_reopened`.

The database rules make `/events` **write-only** from browsers: nobody can read, edit or delete events from the site, events can't carry any extra fields (so notes, PINs or keys can't sneak in), and timestamps have to come from the server. Only the insights agent, using a service account, can read them.

### The weekly report

Every Monday morning the **Weekly report** workflow runs the agent in `agent/`. It reads the events, compares the last 7 days with the 7 before, and commits a report to [`reports/README.md`](reports/README.md) with a chart, the key numbers, what stands out and up to three next steps. Things it watches for:

- **Real sessions** (rooms with 3+ laptops) vs rooms that were only tests
- **Time to fill a room**: first laptop in to 80% of laptops in. This is the core promise.
- **Wrong PIN rate** and **share joining on phones** (keys are needed on laptops)
- **Copies per attendee**, i.e. whether people actually use what's pasted
- **"I'm stuck" rate**, rooms left open, and rooms getting close to Firebase's 100-connection free limit
- **Returning presenters**

The repo is public, so the report is deliberately aggregate: no room codes, room names or user IDs. A test checks this.

The insights are rule-based for now. `agent/src/insights.js` takes a metrics object and returns `{ headline, insights, actions }`, so it can be swapped for an LLM later without touching anything else.

Try it on fake data:

```bash
cd agent && npm ci && npm run demo   # writes ../reports-demo/
```

## Deploys and reports (GitHub Actions)

| Workflow | When | What it does |
|---|---|---|
| **CI** | Every push to a branch and every pull request | Syntax checks, database rules tests on the Firebase emulator, an end-to-end browser test of the analytics, and the agent's tests |
| **Deploy** | Every push to `main` | Runs CI first. If it passes, deploys the database rules to Firebase and the site to Netlify with the real Firebase config |
| **Weekly report** | Mondays ~07:45 Dublin time, or on demand | Runs the agent and commits the report |

### One-time setup

Add these in **GitHub > Settings > Secrets and variables > Actions > New repository secret**:

| Secret | Where to get it |
|---|---|
| `FIREBASE_WEB_CONFIG` | Your web config as JSON, e.g. `{"apiKey":"AIza...","authDomain":"...","databaseURL":"https://...firebasedatabase.app","projectId":"roomkey-cb4d3","appId":"..."}`. Same values as `firebase-config.js`, with quotes around the keys. |
| `FIREBASE_DATABASE_URL` | The `databaseURL` from above |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase console > Project settings > Service accounts > **Generate new private key**. Paste the whole JSON file. |
| `NETLIFY_AUTH_TOKEN` | Netlify > User settings > Applications > Personal access tokens > **New access token** |
| `NETLIFY_SITE_ID` | Netlify > your site > Site configuration > Site details > **Site ID** |

Then:

1. If your Netlify site is linked to this repo, turn off its own builds (Site configuration > Build & deploy > **Stop builds**). GitHub Actions does the deploy now, and Netlify building straight from the repo would ship the placeholder `firebase-config.js`.
2. Push to `main`, or go to **Actions > Deploy > Run workflow**.
3. Check `.firebaserc` has your Firebase project ID (`roomkey-cb4d3`).
4. If the rules deploy step fails with a permissions error, open Google Cloud console > IAM, find the `firebase-adminsdk` service account and add the **Firebase Realtime Database Admin** role.

### Running the tests locally

```bash
npm ci
npm run check        # syntax and JSON checks
npm run test:e2e     # browser test (needs: npx playwright install chromium)
npm run test:rules   # rules test (needs Java 21 for the Firebase emulator)
cd agent && npm ci && npm test
```
