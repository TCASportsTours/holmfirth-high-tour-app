# TCA Tours — Holmfirth High · New York 2026 · Tour App (v1)

A phone app (installable web app) for the Holmfirth High "Business and New York Experience" trip, 25–30 October 2026.
Same idea as the GCS Tobago app: one spreadsheet, uploaded through the admin page, drives everything. Built to the **TCA Tours brand book**: charcoal and gold, Cormorant Garamond and Work Sans, square corners.

Version: **v3** · 11 October 2026 (v3: website links on itinerary events; v2: separate Teacher and TCA Tours staff sign-ins; parent/family option removed)

## What's in it

| Students and staff | Staff only (teacher or TCA Tours password) |
|---|---|
| **Today**: live New York and UK clocks, weather, "Up next" countdown | **Register**: live roll calls shared across staff phones. Each teacher picks their name once; they can start their own group's register or a roll call for everyone. TCA staff can start any group's |
| **Itinerary**: every day, tap for details and how to get there | **Rooms**: room groups and teachers, type in room numbers once allocated |
| **Getting around**: hostel, which train, subway diagram (110th St → South Ferry → Brooklyn), MTA map links | **Medical, dietary & SEND** in one place: filter by type and by teacher's group, urgent cards ("Check") first |
| **Safety tips**, **Getting to the hostel**, **Flights**, **Teachers** | **Meal orders**: Groove and Ellen's totals plus per-person orders, cross-checked against dietary notes |
| **What to take**: tick-off packing list (its own tab) | **TCA only** rows: Schedule rows marked *TCA only* reach TCA Tours staff and admin only, never teachers |
| **Emergency**: call 911, "show this to someone" hostel card, call the hostel | **Transfers**: coach bookings, references and dispatcher numbers |
| **Alerts**: pop-up messages from staff | **Contacts**: staff emergency list. **Send alert** to every phone |

## Where things live

```
public/                 ← the website (the only folder Netlify serves)
  index.html            the app
  admin.html            upload the App Database + Publish
  js/parse-db.js        reads the App Database workbook (shared by admin + build script)
  js/tour-default.js    bundled PUBLIC itinerary, shown until the first Publish
  img/                  TCA Tours logos + app icons (from the brand pack)
  vendor/               SheetJS spreadsheet reader (fallback copy, Apache-2.0)
netlify/functions/tour.mjs   the backend (itinerary, alerts, staff data, register, rooms)
dev/                    local preview server + build script
```

## Privacy: read this first

This repository is **public**. It must never contain pupil data.

- The **App Database** (`Holmfirth_NYC_App_Database_v1.xlsx`) holds children's medical and dietary details. Keep it on your computer or school drive. `.gitignore` blocks `.xlsx` files.
- `admin.html` reads the spreadsheet **inside your browser** and publishes it in two halves:
  - **public** (itinerary, flights, hostel, safety tips): anyone with the link can read it
  - **staff only** (students, medical, rooms, contacts, transfer refs, meal orders): the server only returns it when the staff password is sent
- Before publishing, the admin page checks that no student name or transfer reference has slipped into the public half. If it finds one, it blocks the Publish button.
- Staff phones keep a copy of the staff data so it works without signal on the subway. **Sign out** on the More page wipes it from that phone.

## Set up on Netlify (once)

1. Netlify → **Add new site → Import an existing project → GitHub** → pick this repo.
   Leave the build command blank. `netlify.toml` already sets publish = `public`, functions = `netlify/functions`.
2. Site configuration → **Environment variables**, add:
   - `STAFF_PASSWORD`: the **Teacher** sign-in password (required)
   - `TCA_PASSWORD`: the **TCA Tours staff** sign-in password
   - `ADMIN_PASSWORD`: the password for publishing in admin.html
   Save them as ordinary (not "secret") variables: on this Netlify plan, secret values didn't save.
3. **Deploys → Trigger deploy** (environment variables only take effect after a deploy).
4. Check the **Functions** tab lists `tour`.
5. Open `https://<your-site>/admin.html`, enter the admin password, load the App Database and press **Publish**.

## Updating

- **Itinerary, students, contacts and so on**: edit the App Database, upload it in `admin.html`, press Publish. No redeploy is needed. Save the file as the next version (v2, v3…).
- **Room numbers**: staff type them straight into the app (More → Rooms). They override the spreadsheet column.
- **App design or features**: change the code, commit, push. Netlify redeploys.
- Optional: refresh the bundled public itinerary from a new App Database:
  `npm install && node dev/build-defaults.mjs path/to/App_Database_vN.xlsx`

## Local preview

```
npm install
STAFF_PASSWORD=test ADMIN_PASSWORD=admin node dev/dev-server.mjs
# open http://localhost:8787  and  http://localhost:8787/admin.html
```

## Brand notes

- Colours: Charcoal #414042, Gold #EFCA50 (rules, the one primary button, "Today" tag; never as text), Ink #2A292B, Stone #F4F3F1, Slate #6E6D70, Hairline #DDDCDC.
- Two deliberate exceptions to the two-colour rule, both functional:
  - **Emergency red** #B03A2E: the SOS button and "Check" / "missing" flags. This red is taken from the brand book's own "don't" marks.
  - **Official MTA red** #EE352E on the 1/2/3 subway bullets, so they match the station signs.

## v7 additions

- **Offline mode**: `public/sw.js` keeps a copy of the app, itinerary, fonts and icons, so the app opens with no signal. It is network-first, so with signal you always get the latest. Staff-only data is never stored in the service worker. Register ticks and room numbers made with no signal are saved on the phone and sync automatically when signal returns.
- **Push alerts**: students and staff tap **Turn on alerts**; staff alerts then arrive as phone notifications even with the app closed. On iPhone the app must be added to the home screen first (iOS 16.4+). Needs the Netlify variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.
- **Live subway status**: the 1/2/3 lines (plus A, C, E, 7, R, W) from the MTA's free service-alerts feed, refreshed every 2 minutes, on Getting around and Today.
- **Registers**: delete a roll call; **Export registers (CSV)** for the school's records, with who was present, when they were ticked and by whom.

## v8 additions

- **Student accounts**: Student → find your name (first name + surname initial, e.g. "Lucy A.") → "You are logging in as Lucy A. Is this you?" → Yes / No. Students stay signed in and can't sign out; a teacher can reset the phone with the staff password (More → Wrong name? Ask a teacher). The name list only comes from a Publish: it is never in this repo, and full surnames are never shown publicly.
- **Alerts to one or more students**: Send alert → Choose students (tick individuals or a whole group). Only those students' phones get it, by notification and in the app; staff see who it went to.
- **Add to home screen prompt** the first time the link is opened (then at most once a day). On Android it is a one-tap button; iPhones only allow it from Safari's Share menu, so the prompt shows those steps.
- **Turn on alerts prompt**: when the app is opened from the home screen and alerts aren't on, it asks straight away. After that one tap, alerts arrive on the lock screen without opening the app.

## v9: hardened after break-it testing

| Attack | Before | Now |
|---|---|---|
| Guessing staff passwords | Unlimited | Locked for 15 minutes after 8 wrong tries, per connection and device (so one student on hostel wifi can't lock teachers out) |
| Reading another student's private alert from the public name list | Possible | Each student's phone makes a secret token at sign-in; private alerts only go to phones holding it (max 3 phones per name; a teacher or admin can reset) |
| Push subscriptions pointing at any web address | Accepted | Only real push services (Google, Apple, Mozilla, Microsoft) |
| Huge alerts / junk data | Accepted | Size limits; titles 120 characters, messages 2,000; register and room keys validated |
| Two staff sending alerts at once | One lost | Each alert is added or removed individually on the server |
| A late offline sync overwriting a newer register tick | Overwrote | Newest tick wins |
| A name with an apostrophe (Mrs O'Neill) | Button broke | Safe in every button |

Known limits (by design): students sign in without a password, so someone could pick a classmate's name first (the real student then sees "already signed in" and a teacher resets it); the four teachers share one password; alerts to everyone are readable by anyone with the link. Don't put sensitive details in alerts.

## v10: who's signed in, and signing students out

- **Who's signed in** (TCA Tours staff in the app: More → Who's signed in; and admin.html → Who's signed in): every student, signed in or not, how many phones, first sign-in, last seen, iPhone/Android, alerts on/off; plus staff sign-ins.
- **Sign out** a student (TCA Tours and admin passwords only — teachers can't): their phones are signed out within about a minute and see "TCA Tours has signed you out"; they can sign in again with the right name.
- Admin → Clear test data now also has **Clear sign-in history**.

