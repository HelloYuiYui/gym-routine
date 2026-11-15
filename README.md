# Gym Log

A phone web page for three training partners: pick a session, see last time's
numbers and rest times, log today's work. Static HTML/CSS/JS on GitHub Pages,
data in Supabase. No build step, no npm dependencies.

## Local-only mode

While `js/config.js` is empty the app runs without a backend: no sign-in, data
lives only on this phone (localStorage), and the header reads
`Local only — not synced`. Everything you log is kept in the write queue; once
the config is filled in, the queue is sent to Supabase on the next load.

## Supabase setup (once)

1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it.
3. **Authentication → Users → Add user → Create new user**: one login shared
   by the group. The app asks for a **username**, but Supabase needs an email,
   so create the user as `<username>@example.com` (for example
   `gymbros@example.com`) with a password of your choice, and tick "Auto
   Confirm User". In the app you then sign in as `gymbros`. No mail is ever
   sent to that address.
4. **Authentication → Sign In / Providers**: turn off **Allow new users to sign
   up**, so nobody else can create an account.
5. **Project Settings → API**: copy the **Project URL** and the **anon / public
   (publishable) key** into `js/config.js`:

   ```js
   export const SUPABASE_URL = 'https://your-project.supabase.co';
   export const SUPABASE_ANON_KEY = 'your-anon-key';
   ```

   Only these two values go in the page. Never put the service-role (secret)
   key in this repository; it bypasses row-level security.

A free project pauses after about a week without use. If the app stops
syncing, open the Supabase dashboard and resume the project. Nothing logged on
the phones is lost meanwhile; it waits in the queue.

## Run locally

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>. ES modules need a server; opening `index.html`
from the file system does not work.

Tests for the pure logic and the queue:

```sh
npm test
```

## Publish on GitHub Pages

1. Create a GitHub repository and push this project to it.
2. **Settings → Pages → Build and deployment**: Source **Deploy from a
   branch**, branch `main`, folder `/ (root)`. Save.
3. After a minute the site is at `https://<user>.github.io/<repo>/`. All paths
   in the app are relative, so it works under the repository sub-path.
4. On each phone: open the link, sign in with the group login, pick your name,
   and add the page to the home screen.

The app shell (HTML, CSS, JS, and the supabase-js module) is kept on the phone
by a service worker (`sw.js`), so the app opens even with no signal. It serves
the saved copy first and fetches the new one in the background: after you
publish an update (including filling in `js/config.js`), each phone may need
one extra reload to pick it up. The same applies while developing locally.
