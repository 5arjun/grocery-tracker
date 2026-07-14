# Inventory Snapshot

> **Last Updated:** _(not yet initialized)_
> 
> This file reflects all current open batches and estimated remaining quantities.
> Update this file after every receipt, meal log, waste event, or reconciliation.

---

## Open Batches

_No batches yet. Add your first grocery receipt to initialize inventory._

---

## Batch Status Key

| Status | Meaning |
|--------|---------|
| `OPEN` | Active batch with remaining quantity |
| `DEPLETED` | Batch fully used (explicit or reconciled) |
| `WASTED` | Batch closed due to waste event |
| `FUZZY` | Remaining qty is approximate — pending reconciliation |

---

## Batch Format (per item)

```
### [Item Name]
| Batch ID | Date Purchased | Store | Qty Purchased | Unit | Unit Cost | Qty Remaining | Status | Notes |
|----------|---------------|-------|--------------|------|-----------|--------------|--------|-------|
| B001     | YYYY-MM-DD    | Store | X            | unit | $X.XX     | X            | OPEN   |       |
```
