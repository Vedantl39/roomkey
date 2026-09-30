# Roomkey

**Live:** https://roomkey-dublin.netlify.app

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
| `database.rules.json` | Security rules you paste into Firebase |

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
