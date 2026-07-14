# 🛒 Grocery Tracker

A persistent grocery & meal tracker with a **live dashboard** — no spreadsheets, no scripts, nothing to install or run.

**👉 Live site: https://5arjun.github.io/grocery-tracker/**  
(Bookmark it on your phone — it's built to look good there.)

## How it works

The whole system is two things:

1. **CSV files** under [`docs/data/`](docs/data/) — the single source of truth.
2. **A static website** under [`docs/`](docs/) that reads those CSVs directly in your browser and computes every stat live.

That's it. There is **no build step, no Python, no GitHub Action**. When the CSV
files change, the website shows the new numbers on the next reload.

```
You tell Claude what you bought / ate
        ↓
Claude edits the CSV files under docs/data/
        ↓
git push
        ↓
GitHub Pages serves the updated site — you refresh and see new stats
```

## The data (source of truth)

Five flat CSV files, human- and AI-editable, each with a header row:

| File | What it holds |
|------|---------------|
| [`docs/data/purchases.csv`](docs/data/purchases.csv) | Every line item from every receipt |
| [`docs/data/meals.csv`](docs/data/meals.csv) | One row per meal, with an estimated cost |
| [`docs/data/meal_usage.csv`](docs/data/meal_usage.csv) | Which items each meal used (links meals → inventory) |
| [`docs/data/waste.csv`](docs/data/waste.csv) | Explicitly reported waste events |
| [`docs/data/inventory.csv`](docs/data/inventory.csv) | Current open batches and remaining quantity |

Column definitions and the rules for editing them live in
[`INSTRUCTIONS.md`](INSTRUCTIONS.md).

## The dashboard

Open the live URL and you get:

- **KPI tiles** — total spent, avg cost per meal, waste %, grocery trips, meals logged
- **Charts** — spend over time, avg cost by meal type, top items by cost, waste vs. spend
- **Tables** — top items by frequency, current inventory, recent purchases / meals / waste

Everything is computed in the browser from the CSVs. With empty CSVs the page
loads cleanly and shows a friendly "log your first receipt" state.

## Usage — the loop

You never open a spreadsheet or run a command. Just talk to Claude:

- *"Here's my receipt from Kroger…"* → Claude appends rows to `purchases.csv` and `inventory.csv`
- *"For dinner I had a chicken rice bowl"* → Claude adds a row to `meals.csv` (and `meal_usage.csv`)
- *"I threw out half an onion"* → Claude adds a row to `waste.csv` and updates `inventory.csv`

Then push, refresh the site, and the stats update.

**Using another AI (e.g. a Perplexity Space)?** Paste the orientation prompt in
[`SPACE_PROMPT.md`](SPACE_PROMPT.md) into the Space's custom instructions so every
new chat knows the setup and reads `INSTRUCTIONS.md` first.

## One-time setup (GitHub Pages)

Do this once so the live URL works:

1. Go to your repo on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment → Source**, pick **Deploy from a branch**.
3. Set **Branch** to `main` and the folder to **`/docs`**, then **Save**.
4. Wait about a minute. The site goes live at
   **https://5arjun.github.io/grocery-tracker/**.

Nothing to install. The charting and CSV-parsing libraries load from a CDN, so
viewing the site needs an internet connection (normal for any hosted website).

## Repo structure

```
docs/
├── index.html          ← the dashboard page
├── style.css           ← styles (light + dark)
├── app.js              ← reads CSVs, computes stats, draws charts
└── data/
    ├── purchases.csv    ← source of truth
    ├── meals.csv
    ├── meal_usage.csv
    ├── waste.csv
    └── inventory.csv
INSTRUCTIONS.md          ← workflow rules for AI sessions
README.md
```
