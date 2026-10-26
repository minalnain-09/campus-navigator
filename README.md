# LPU Campus Navigator (Stage 1)

A mobile-first campus map for first-year students. Plain HTML, CSS and JavaScript with Leaflet. No API keys, no backend.

## How to run it

The app loads `places.json` with `fetch`, and browsers block that when you just double-click `index.html`. So you need to run a tiny local web server:

1. Open a terminal in this folder.
2. Run:
   ```
   python3 serve.py
   ```
   (This is like `python3 -m http.server 8000`, but tells the browser never to cache, so a normal refresh always shows the latest version. If you use `http.server` instead, refresh with Cmd+Shift+R after every change.)
3. Open **http://localhost:8000** in your browser.

To try it on your phone: connect the phone to the same Wi-Fi, find your computer's IP address (e.g. `192.168.1.5`), and open `http://192.168.1.5:8000`.
Note: phones only allow GPS ("Locate me") and clipboard copy on `https` or `localhost`, so on a plain IP address those two features may not work. The easiest fix is to host the folder on GitHub Pages (free, gives you an `https` link).

## Files

| File | What it does |
|---|---|
| `index.html` | Page layout: map, buttons, place card |
| `style.css` | All the styling (draggable bottom sheet on phones, left panel on desktop) |
| `app.js` | Map, pins and labels, filters, locate me, recentre, admin coordinate copy |
| `routes.js` | Search logic, directions (From/To, step cards, walking mode), route recorder |
| `help.js` | I'm lost, Report a problem, test mode |
| `ui.js` | The bottom sheet: home (search, categories, popular, recent), place details, arrival screen |
| `places.json` | List of places (edit this to add real places) |
| `routes.json` | Recorded walking routes |
| `serve.py` | Local development server with caching turned off |
| `photos/` | Put place photos here (optional; a placeholder shows if missing) |

## Adding real places

1. Tap the **gear** (top-right, next to Map/Satellite) to turn on Admin.
2. Tap the exact spot on the map. The coordinates are copied, e.g. `"lat": 31.255123, "lng": 75.704567`.
3. Paste them into a new entry in `places.json`.
4. Refresh the page.

Categories (and their colours): `academic`, `food`, `hostel`, `admin`, `sports`, `help`.

`places.json` holds 57 real campus places, one per line. Each has an `id`, `name`, `aliases` (short forms for search later), `block` (only for Blocks 25–57), `floor`, `category`, `group` (the heading shown on the card), `priority` (1 = always shown, 2 = from zoom 17, 3 = from zoom 18), `lat`, `lng`, `landmark_note` and `photo`. `floor`, `landmark_note` and `photo` are empty for now, so fill them in as you collect them.

When the app opens, the map zooms to fit all the places. The recentre button does the same.

## Running a usability test

1. Tap the **gear** (top-right, next to Map/Satellite) to turn on Admin, then open **Test mode** at the bottom.
2. Enter a tester code (S1, S2…, never a name) and tap **Start session**. A small "Test mode: S1" banner shows that it's recording.
3. Type a task label, then tap **Mark task start** and **Mark task end** around each task. The banner shows a timer.
4. Turn Admin off and hand the phone over. Events are logged automatically.
5. Afterwards: **End session**, then **Export log (CSV)** and **Export feedback (CSV)**.

Everything is stored in this browser's localStorage (`campus_testlog`, `campus_feedback`), so export before clearing site data. The log only holds place and route ids, step numbers, search text and feedback categories. It never holds names or GPS coordinates.

## Recording walking routes

1. Tap the **gear** (top-right, next to Map/Satellite) to turn on Admin, then open **Record route** at the bottom.
2. Pick the **From** and **To** places.
3. Tap along the footpath from start to finish. Drag a numbered dot to fine-tune it, or use **Undo last point**.
4. Tap **Copy route JSON** and paste it into `routes.json`. Replace the old entry if one has the same `id`.
5. Write the `steps`. Each step's `at` is the number of the dot where it happens. `landmark` and `photo` are optional.

A route also works backwards automatically (B→A uses A→B's path). To write proper step text for the reverse direction, add a `"reverse_steps"` list in the same format. Its `at` numbers count from the B end. Routes with an empty `path` are placeholders and are ignored until you record them.

## Updating the app

`index.html` has a version stamp (`<meta name="app-version">`) and `?v=` on every script and stylesheet link. When you change any of these files, bump the version in all those places and in `APP_VERSION` at the top of `app.js`. If a browser ever mixes old and new files, the app shows "The app was updated. Refresh" instead of breaking.
