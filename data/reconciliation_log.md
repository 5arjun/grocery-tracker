# Reconciliation Log

> **Purpose:** Tracks fuzzy items (cheese, oil, rice, sauces, spices, etc.) whose costs cannot be finalized per meal immediately.
> A batch stays "pending" until it is confirmed depleted — then its cost is split across all meals that used it.

---

## Pending Reconciliations

_No pending items yet._

---

## Completed Reconciliations

_None yet._

---

## Record Format

```
### [Item Name] — Batch [ID] — [Date Purchased]
- **Status:** PENDING | RECONCILED
- **Batch Total Cost:** $X.XX
- **Batch Qty:** X units
- **Meals Using This Batch:** 
  - YYYY-MM-DD [meal type]: [description]
  - YYYY-MM-DD [meal type]: [description]
- **Reconciled On:** YYYY-MM-DD (if applicable)
- **Cost Split:** $X.XX per meal (X meals)
- **Notes:** 
```
