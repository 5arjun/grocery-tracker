# INSTRUCTIONS.md — Master Workflow Rules

> **Read this file at the start of every session before processing any input.**

---

## Purpose

This repo is the persistent source of truth for a grocery and meal tracking system. It is designed so that any new AI chat session can pick up exactly where the last one left off — no lost context between receipts and meal logs.

---

## Core Rules (Non-Negotiable)

### 1. Depletion-Based Tracking
Usage is **inferred from meal descriptions**, not from exact portion sizes. The user reports meals by description only (e.g., "3 eggs with cheese," "chicken rice bowl"). Never require exact weights or volumes.

### 2. FIFO Batch Logic
Each grocery trip creates a new **batch** per item. The oldest open batch for an item is always depleted first — unless the user provides an explicit override hint.

**Override hints to watch for:**
- "used the new bag"
- "ran out of the old block"
- "last of the [item]"
- Any explicit reference to a specific batch by date, brand, or size

When an override hint is detected, apply the depletion to the specified batch instead of the FIFO default.

### 3. Leftover Carryover
Leftover inventory **always carries across trips**. A new receipt arriving **never** implies that old items were wasted or used up. Open batches remain open until explicitly depleted or wasted.

### 4. Explicit-Only Waste
Waste is **never inferred**. Only log waste when the user directly states it (e.g., "threw out half an onion," "had to toss the milk"). When waste is logged:
- Calculate the dollar value from that item's batch unit cost
- Log to `data/waste_logs/`
- Update `data/inventory_snapshot.md`
- Record in the Waste tab of `grocery_tracker.xlsx`

### 5. Fuzzy Item Reconciliation
Fuzzy items (cheese, rice, oil, hot sauce, butter, condiments, spices, etc.) have costs that **cannot be finalized per meal immediately**. Instead:
- Mark the item as "fuzzy / pending reconciliation" in `data/reconciliation_log.md`
- Split the cost retroactively across all meals that plausibly used that batch, once the batch is confirmed depleted
- A batch is confirmed depleted when:
  - The user explicitly states it (e.g., "finished the block of cheese")
  - **OR** the item is absent from a new receipt AND absent from recent meal logs for an extended period (use judgment — flag for user confirmation before finalizing)

---

## Before Processing Any Input — Checklist

Run through this every session, in order:

- [ ] **1. Read `data/inventory_snapshot.md`** — understand all current open batches and remaining quantities
- [ ] **2. Read `data/reconciliation_log.md`** — note any pending fuzzy items awaiting finalization
- [ ] **3. Read the most recent file(s) in `data/grocery_trips/`** — understand what was last purchased
- [ ] **4. Read the most recent file(s) in `data/meal_logs/`** — understand what was last consumed
- [ ] **5. Check `data/waste_logs/`** for any recent waste events

Only after completing this checklist should you process any new receipt, meal log, or waste report.

---

## Processing Instructions

### A. When a Receipt / Grocery Trip is Provided

1. Parse all line items: item name, quantity, unit (if visible), price paid, store, date
2. Create a new file: `data/grocery_trips/YYYY-MM-DD.md` using `templates/grocery_trip_template.md`
3. For each item:
   - Check `data/inventory_snapshot.md` for an existing open batch of that item
   - If an open batch exists: add the new purchase as a **new batch** (do NOT merge into the existing batch)
   - Create a new batch entry in `data/inventory_snapshot.md` with status: `OPEN`
4. Add all new rows to the **Purchases** tab of `grocery_tracker.xlsx`
5. Update the **Inventory** tab of `grocery_tracker.xlsx`
6. Do NOT mark any old batch as depleted or wasted — leftover carryover rule applies

### B. When a Meal is Reported

1. Parse the meal description: meal type (breakfast/lunch/dinner/snack), time if given, items mentioned
2. Create or append to the day's file: `data/meal_logs/YYYY-MM-DD.md` using `templates/meal_log_template.md`
3. For each item in the meal:
   - Identify which open batch(es) it likely depleted from (FIFO default, or override if hinted)
   - Apply a **reasonable inferred depletion** to `data/inventory_snapshot.md`
   - For fuzzy items: mark as "fuzzy" in `data/reconciliation_log.md` — do not finalize cost yet
4. Add the meal row to the **Meals** tab of `grocery_tracker.xlsx`
5. Add usage link rows to the **Meal_Usage** tab
6. Recalculate dashboard stats (see Stats section)

### C. When Waste is Reported

1. Parse: item, quantity wasted, reason (optional)
2. Look up the unit cost from the relevant open batch in `data/inventory_snapshot.md`
3. Calculate waste dollar value: `qty_wasted × unit_cost`
4. Create or append to `data/waste_logs/YYYY-MM-DD.md` using `templates/waste_log_template.md`
5. Update `data/inventory_snapshot.md`: reduce remaining qty; mark batch `DEPLETED` if qty reaches 0
6. Add row to the **Waste** tab of `grocery_tracker.xlsx`
7. Recalculate dashboard stats

### D. When Fuzzy Reconciliation is Triggered

1. Identify the depleted batch from `data/reconciliation_log.md`
2. Gather all meals in `data/meal_logs/` that used this item during the batch's active period
3. Split the batch cost evenly (or proportionally if portion sizes were noted) across those meals
4. Update cost per meal entries retroactively in the **Meals** tab
5. Add a reconciliation record to the **Reconciliation** tab
6. Update `data/reconciliation_log.md`: mark the batch as `RECONCILED`
7. Recalculate all affected dashboard stats

---

## Stats to Maintain (Dashboard)

These live in the **Dashboard** tab of `grocery_tracker.xlsx` and should be recalculated after every update:

| Stat | Description |
|------|-------------|
| `cost_per_meal` | Cost attributed to each individual meal |
| `avg_cost_per_meal` | Rolling average across all logged meals |
| `avg_cost_breakfast` | Average meal cost for breakfast meals only |
| `avg_cost_lunch` | Average meal cost for lunch meals only |
| `avg_cost_dinner` | Average meal cost for dinner meals only |
| `meals_per_grocery_trip` | Meals consumed between each trip (per trip window) |
| `total_spent` | Cumulative grocery spend |
| `total_waste_dollars` | Cumulative waste in dollars |
| `waste_pct` | Waste as % of total spend |
| `avg_spend_per_trip` | Average receipt total across all trips |
| `top_items_by_cost` | Top 5 items by total spend |
| `top_items_by_frequency` | Top 5 items by meal appearance frequency |

---

## Notes for AI Sessions

- Always be explicit about what you are assuming when inferring depletion amounts for meals.
- When a fuzzy item's batch is being considered for reconciliation based on absence (not explicit user statement), **flag it to the user for confirmation** before finalizing.
- If the inventory snapshot seems stale or inconsistent with meal logs, surface the discrepancy to the user rather than silently resolving it.
- Never delete data. If a correction is needed, add a correction record with a timestamp.
