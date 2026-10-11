# TCA Tours — Holmfirth High · New York 2026 · Tour App (v1)

A phone app (installable web app) for the Holmfirth High "Business and New York Experience" trip, 25–30 October 2026.
Same idea as the GCS Tobago app: one spreadsheet, uploaded through the admin page, drives everything. Built to the **TCA Tours brand book**: charcoal and gold, Cormorant Garamond and Work Sans, square corners.

Version: **v2** · 11 October 2026 (v2: separate Teacher and TCA Tours staff sign-ins; parent/family option removed)

## What's in it

| Students and staff | Staff only (teacher or TCA Tours password) |
|---|---|
| **Today**: live New York and UK clocks, weather, "Up next" countdown | **Register**: live head-count roll calls, shared across staff phones |
| **Itinerary**: every day, tap for details and how to get there | **Rooms**: room groups and teachers, type in room numbers once allocated |
| **Getting around**: hostel, which train, subway diagram (110th St → South Ferry → Brooklyn), MTA map links | **Medical**, **Dietary**, **SEND**: urgent cards ("Check") sorted first |
| **Safety tips**, **Getting to the hostel**, **Flights**, **Teachers** | **Meal orders**: Groove and Ellen's totals plus per-person orders, cross-checked against dietary notes |
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
