# INSTRUCTIONS.md — Master Workflow Rules

> **Read this file at the start of every session before processing any input.**

---

## Purpose

This repo is the persistent source of truth for a grocery and meal tracking
system. Any new AI chat session can pick up exactly where the last one left off —
no lost context between receipts and meal logs.

The source of truth is **five CSV files under `docs/data/`**. A static website
(`docs/index.html` + `style.css` + `app.js`) reads those CSVs directly in the
browser and computes every stat live. **There is no script and no build step** —
when you edit the CSVs and push, the live site updates on the next reload.

Your job each session: read the CSVs, then **append or edit rows** in them to
reflect what the user reports. Never write to a spreadsheet; never run a builder.

---

## The Data Files (source of truth)

All under `docs/data/`. Each ships with a header row; append data rows below it.
Keep values plain: no `$` and no thousands separators in numeric columns (write
`4.50`, not `$4.50`; write `1200`, not `1,200`). If a text value contains a
comma, wrap that field in double quotes (standard CSV).

### `purchases.csv` — every line item from every receipt
`trip_id,batch_id,date,store,item,brand_notes,qty,unit,total_price,unit_cost`
- `trip_id` — sequential per shopping trip: `T001`, `T002`, … (same for all items on one receipt)
- `batch_id` — unique per line item: `B001`, `B002`, … (this item's batch)
- `date` — `YYYY-MM-DD`
- `total_price` — price paid for this line (drives `total_spent`)
- `unit_cost` — `total_price / qty` (used to value waste and meals)

### `meals.csv` — one row per meal
`meal_id,date,meal_type,description,est_cost,notes`
- `meal_id` — sequential: `M0001`, `M0002`, …
- `meal_type` — `breakfast` | `lunch` | `dinner` | `snack`
- `description` — the user's raw description, verbatim
- `est_cost` — estimated cost of the meal (may be provisional while fuzzy items are pending)

### `meal_usage.csv` — which items each meal used (meal → inventory link)
`meal_id,batch_id,item,inferred_qty,unit,fuzzy,notes`
- `meal_id` — matches a row in `meals.csv`
- `batch_id` — the batch depleted (FIFO default, or an override — see rules)
- `fuzzy` — `yes` | `no` (see Fuzzy Reconciliation)
- One row per item used; a meal with three items has three rows here.

### `waste.csv` — explicit waste events only
`date,item,batch_id,qty_wasted,unit,unit_cost,waste_value,reason`
- `waste_value` — `qty_wasted × unit_cost` (drives `total_waste_dollars` and `waste_pct`)

### `inventory.csv` — current open batches
`batch_id,item,date_purchased,store,qty_purchased,unit,unit_cost,qty_remaining,status,notes`
- `status` — `OPEN` | `DEPLETED` | `WASTED` | `FUZZY`
- `qty_remaining` — reduce as meals/waste deplete the batch

---

## Core Rules (Non-Negotiable)

### 1. Depletion-Based Tracking
Usage is **inferred from meal descriptions**, not from exact portion sizes. The
user reports meals by description only (e.g., "3 eggs with cheese," "chicken rice
bowl"). Never require exact weights or volumes.

### 2. FIFO Batch Logic
Each grocery trip creates a new **batch** per item (a new row in
`purchases.csv` and `inventory.csv`). The oldest `OPEN` batch for an item is
always depleted first — unless the user provides an explicit override hint.

**Override hints to watch for:**
- "used the new bag"
- "ran out of the old block"
- "last of the [item]"
- Any explicit reference to a specific batch by date, brand, or size

When an override hint is detected, deplete the specified batch instead of the
FIFO default.

### 3. Leftover Carryover
Leftover inventory **always carries across trips**. A new receipt arriving
**never** implies that old items were wasted or used up. `OPEN` batches remain
`OPEN` until explicitly depleted or wasted.

### 4. Explicit-Only Waste
Waste is **never inferred**. Only log waste when the user directly states it
(e.g., "threw out half an onion," "had to toss the milk"). When waste is logged:
- Look up the item's `unit_cost` from its batch in `inventory.csv`
- Compute `waste_value = qty_wasted × unit_cost`
- Append a row to `waste.csv`
- Reduce `qty_remaining` in `inventory.csv`; set `status` to `WASTED` if it hits 0

### 5. Fuzzy Item Reconciliation (simplified for v1)
Fuzzy items (cheese, rice, oil, hot sauce, butter, condiments, spices, etc.) have
costs that **cannot be finalized per meal immediately**. For v1 we keep this
lightweight — no separate reconciliation ledger:
- When such an item is used in a meal, set `fuzzy = yes` on its `meal_usage.csv` row.
- In `inventory.csv`, you may mark the batch `status = FUZZY` while its remaining
  quantity is approximate.
- The meal's `est_cost` stays provisional. When the batch is confirmed depleted,
  you may revise the affected meals' `est_cost` to spread the batch cost across
  them, and set the batch `status = DEPLETED`.
- A batch is confirmed depleted when the user says so ("finished the block of
  cheese"), **or** it's been absent from receipts and recent meals long enough
  that you're confident — in which case **flag it to the user for confirmation**
  before finalizing.

> If richer reconciliation is ever needed, add a `reconciliation.csv` and a
> corresponding view — but don't add it preemptively.

---

## Before Processing Any Input — Checklist

Run through this every session, in order:

- [ ] **1. Read `docs/data/inventory.csv`** — understand all current open batches and remaining quantities
- [ ] **2. Read `docs/data/purchases.csv`** — what has been bought, and the last `trip_id` / `batch_id` used
- [ ] **3. Read `docs/data/meals.csv`** — what was last consumed, and the last `meal_id` used
- [ ] **4. Read `docs/data/meal_usage.csv`** — note any rows with `fuzzy = yes` still pending
- [ ] **5. Read `docs/data/waste.csv`** — any recent waste events

Only after this checklist should you process any new receipt, meal, or waste report.

---

## Processing Instructions

### A. When a Receipt / Grocery Trip is Provided
1. Assign the next `trip_id` (e.g., `T003`).
2. For each line item, assign the next `batch_id` (e.g., `B012`) and append a row
   to `purchases.csv` with item, brand/notes, qty, unit, total_price, unit_cost.
3. Append a matching row to `inventory.csv` with `qty_remaining = qty_purchased`
   and `status = OPEN`. **Do not merge** into an existing batch — every purchase
   is a new batch.
4. Do **not** mark any old batch depleted or wasted (leftover carryover rule).

### B. When a Meal is Reported
1. Assign the next `meal_id` and append a row to `meals.csv` (meal_type,
   verbatim description, `est_cost`, optional notes).
2. For each item in the meal, append a row to `meal_usage.csv`:
   - Pick the batch to deplete (FIFO default, or the overridden batch).
   - Set `inferred_qty`, `unit`, and `fuzzy` (`yes` for fuzzy items).
   - Reduce that batch's `qty_remaining` in `inventory.csv`; set `status =
     DEPLETED` if it reaches 0.
3. State your depletion assumptions explicitly to the user.

### C. When Waste is Reported
Follow **Core Rule 4** above: append to `waste.csv`, update `inventory.csv`.

### D. When Fuzzy Reconciliation is Triggered
Follow **Core Rule 5** above: revise affected `meals.csv` `est_cost` values and
set the batch `status = DEPLETED`. Flag absence-based reconciliation to the user
first.

---

## Stats the Dashboard Computes (for reference)

You don't compute these — `docs/app.js` does, live in the browser, from the CSVs.
They're listed so you understand what each column feeds:

| Stat | Source |
|------|--------|
| `total_spent` | sum of `purchases.total_price` |
| `total_meals_logged` | row count of `meals.csv` |
| `avg_cost_per_meal` | average of `meals.est_cost` |
| `avg_cost_breakfast / lunch / dinner` | average `est_cost` grouped by `meal_type` |
| `total_waste_dollars` | sum of `waste.waste_value` |
| `waste_pct` | `total_waste_dollars / total_spent` |
| `total_trips` | distinct `purchases.trip_id` |
| `avg_spend_per_trip` | `total_spent / total_trips` |
| `meals_per_grocery_trip` | `total_meals_logged / total_trips` |
| `top_items_by_cost` (5) | `purchases.total_price` summed per item |
| `top_items_by_frequency` (5) | distinct meals per item in `meal_usage.csv` |
| spend-over-time | `purchases.total_price` summed per `date` |

---

## Notes for AI Sessions

- Always be explicit about what you are assuming when inferring depletion amounts.
- For absence-based fuzzy reconciliation, **flag it to the user for confirmation**
  before finalizing.
- If inventory seems stale or inconsistent with the meal log, surface the
  discrepancy rather than silently resolving it.
- **Never delete data.** If a correction is needed, edit the specific cell/row in
  place (or add a corrected row) — don't rewrite history wholesale.
- Keep CSVs valid: matching column counts, no `$`/comma inside numeric fields,
  and quote any text field that contains a comma.
