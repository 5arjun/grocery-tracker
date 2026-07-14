# 🛒 Grocery Tracker

A persistent, AI-readable grocery and meal tracking system using GitHub as the source of truth.

## How It Works

- **Receipts** → logged as itemized purchase data in `data/grocery_trips/`
- **Nightly meal reports** → logged by description in `data/meal_logs/`
- **Inventory** → tracked via depletion-based FIFO batch logic in `data/inventory_snapshot.md`
- **Waste** → explicit-only, never inferred, logged in `data/waste_logs/`
- **Fuzzy reconciliation** → retroactive cost splits tracked in `data/reconciliation_log.md`

## Quick Start (New Session)

1. Read `INSTRUCTIONS.md` first — master workflow rules
2. Read `data/inventory_snapshot.md` — current open batches
3. Read `data/reconciliation_log.md` — pending fuzzy items
4. Check the most recent files in `data/grocery_trips/` and `data/meal_logs/`

## Repo Structure

```
data/
├── grocery_tracker.xlsx        ← master Excel workbook
├── inventory_snapshot.md       ← current open batches / remaining qty
├── reconciliation_log.md       ← pending fuzzy-item cost adjustments
├── grocery_trips/              ← one .md per receipt date
├── meal_logs/                  ← one .md per day
├── waste_logs/                 ← one .md per waste event/day
└── exports/                    ← generated CSVs / reports
templates/
├── grocery_trip_template.md
├── meal_log_template.md
└── waste_log_template.md
```
