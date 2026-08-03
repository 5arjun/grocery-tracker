/* =====================================================================
   Grocery Tracker — Linear-style multi-tab dashboard
   Reads the CSVs under docs/data/, computes every stat in the browser,
   and renders five hash-routed views. No build, no server code.
   ===================================================================== */

const CSV_FILES = {
  purchases:   "data/purchases.csv",
  meals:       "data/meals.csv",
  mealUsage:   "data/meal_usage.csv",
  waste:       "data/waste.csv",
  inventory:   "data/inventory.csv",
  outsideFood: "data/outside_food.csv",
  fun:         "data/fun.csv",
};

const VIEW_ORDER = ["overview", "spending", "meals", "kitchen", "activity"];
const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Lightweight keyword classifier — the CSVs carry no category column, so this
// infers one from the item name. Order matters: earlier rules win (e.g. "sauce"
// must be checked before "cheese" so "Pasta Sauce" doesn't land in Dairy).
const CATEGORY_RULES = [
  { name: "Protein", keywords: ["chicken", "beef", "turkey", "pork", "fish", "salmon", "shrimp", "tofu", "sausage", "bacon", "thigh", "breast"] },
  { name: "Produce", keywords: ["carrot", "mandarin", "apple", "onion", "pepper", "spinach", "salad", "banana", "lettuce", "tomato", "orange", "grape", "berry", "potato", "cucumber", "fruit", "vegetable", "chickpea", "bean"] },
  { name: "Grains & Pantry", keywords: ["pasta", "rice", "cereal", "bagel", "tortilla", "bread", "sauce", "garlic", "oil", "peanut butter", "jar", "flour", "oat", "seasoning"] },
  { name: "Dairy & Eggs", keywords: ["milk", "cheese", "egg", "yogurt"] },
  { name: "Snacks & Treats", keywords: ["cookie", "oreo", "ice cream", "chip", "candy", "chocolate", "cracker", "soda", "juice"] },
];
const CATEGORY_OTHER = "Other";
// Fixed name → color-slot mapping, independent of sort order — a category
// keeps its color even if its rank by spend changes week to week.
const CATEGORY_SLOTS = [
  { name: "Protein",         token: "--series-1" },
  { name: "Produce",         token: "--series-2" },
  { name: "Grains & Pantry", token: "--series-3" },
  { name: "Dairy & Eggs",    token: "--series-4" },
  { name: "Snacks & Treats", token: "--series-5" },
  { name: CATEGORY_OTHER,    token: "--series-6" },
];
function categorize(itemName) {
  const s = String(itemName || "").toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => s.includes(k))) return rule.name;
  }
  return CATEGORY_OTHER;
}

/* ---- tiny helpers -------------------------------------------------- */

function num(v) {
  if (v == null) return NaN;
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return NaN;
  return parseFloat(cleaned);
}
const n0 = (v) => { const x = num(v); return Number.isFinite(x) ? x : 0; };

const fmtMoney = (n) =>
  "$" + (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
const fmtMoney0 = (n) =>
  "$" + Math.round(Number.isFinite(n) ? n : 0).toLocaleString("en-US");
const fmtPct = (n) => (Number.isFinite(n) ? n : 0).toFixed(1) + "%";
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* dates — parsed by hand so "YYYY-MM-DD" never shifts across timezones */

function dateParts(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "").trim());
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}
function dayNum(s) {
  const p = dateParts(s);
  return p ? Date.UTC(p.y, p.mo - 1, p.d) / 86400000 : NaN;
}
function dayToIso(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
function weekdayOf(dateStr) {
  const p = dateParts(dateStr);
  return p ? new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay() : 0;
}
function fmtDateShort(dateStr) {
  const p = dateParts(dateStr);
  if (!p) return dateStr || "";
  return `${MONTHS[p.mo - 1] || p.mo} ${p.d}`;
}

// read a design token off :root so charts match the active theme
function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* inline SVG icon set — stroke-based, themed, consistent across platforms */
const ICONS = {
  grocery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1.3"/><circle cx="18" cy="21" r="1.3"/><path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.6L21 7H6"/></svg>',
  meal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v7a2 2 0 0 0 4 0V2"/><path d="M8 9v13"/><path d="M17 2c-1.7 0-3 2.2-3 5s1.3 5 3 5v10"/></svg>',
  outside: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h16l-1.2 11.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 8Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/></svg>',
  waste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
  fun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4"/><path d="M7 3h10v5a5 5 0 0 1-10 0Z"/><path d="M7 5H4a3 3 0 0 0 3 4M17 5h3a3 3 0 0 1-3 4"/></svg>',
};

/* ---- data loading -------------------------------------------------- */

async function loadCsv(path) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return { rows: [], lastModified: null };
    const text = await res.text();
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
    });
    return { rows: parsed.data || [], lastModified: res.headers.get("last-modified") };
  } catch (_e) {
    // On file:// or offline, fetch throws — treat as empty, never crash.
    return { rows: [], lastModified: null };
  }
}

/* ---- stat computation --------------------------------------------- */

function computeStats(data) {
  const { purchases, meals, mealUsage, waste, inventory, outsideFood, fun } = data;

  // --- purchases / trips ---
  const totalSpent = purchases.reduce((s, r) => s + n0(r.total_price), 0);
  const tripIds = new Set(purchases.map((r) => (r.trip_id || "").trim()).filter(Boolean));
  const tripDates = new Set(purchases.map((r) => (r.date || "").trim()).filter(Boolean));
  const totalTrips = tripIds.size || tripDates.size;
  const avgSpendPerTrip = totalTrips ? totalSpent / totalTrips : 0;

  // --- outside food / fun ---
  const outsideFoodTotal = outsideFood.reduce((s, r) => s + n0(r.cost), 0);
  const hasOutsideFood = outsideFood.length > 0;
  const foodTotal = totalSpent + outsideFoodTotal;
  const outsideFoodPct = foodTotal > 0 ? (outsideFoodTotal / foodTotal) * 100 : 0;
  const funTotal = fun.reduce((s, r) => s + n0(r.cost), 0);
  const hasFun = fun.length > 0;
  const allSpendTotal = totalSpent + outsideFoodTotal + funTotal;
  const hasAnySpend = allSpendTotal > 0;

  // --- spend by date (groceries / outside / fun), gap-filled ---
  const byDate = new Map(); // dayNum -> {g,o,f}
  const bump = (dateStr, key, val) => {
    const d = dayNum(dateStr);
    if (!Number.isFinite(d)) return;
    if (!byDate.has(d)) byDate.set(d, { g: 0, o: 0, f: 0 });
    byDate.get(d)[key] += val;
  };
  for (const r of purchases) bump(r.date, "g", n0(r.total_price));
  for (const r of outsideFood) bump(r.date, "o", n0(r.cost));
  for (const r of fun) bump(r.date, "f", n0(r.cost));

  const spendDays = [...byDate.keys()].sort((a, b) => a - b);
  const firstDay = spendDays[0];
  const lastDay = spendDays[spendDays.length - 1];

  // every calendar day from first to last — zero-filled so gaps are honest
  const dailySpend = [];
  if (spendDays.length) {
    for (let d = firstDay; d <= lastDay; d++) {
      const v = byDate.get(d) || { g: 0, o: 0, f: 0 };
      dailySpend.push({ day: d, date: dayToIso(d), groceries: v.g, outside: v.o, fun: v.f, total: v.g + v.o + v.f });
    }
  }
  let running = 0;
  const cumulativeSpend = dailySpend.map((d) => { running += d.total; return { ...d, running }; });

  // --- week over week (7-day windows anchored on the latest data day) ---
  let weekSpend = 0, prevWeekSpend = 0, weekDelta = null;
  if (spendDays.length) {
    for (const d of spendDays) {
      const v = byDate.get(d);
      const t = v.g + v.o + v.f;
      if (d > lastDay - 7) weekSpend += t;
      else if (d > lastDay - 14) prevWeekSpend += t;
    }
    if (prevWeekSpend > 0) weekDelta = ((weekSpend - prevWeekSpend) / prevWeekSpend) * 100;
  }

  // --- weekday pattern: average spend per day-of-week across the range ---
  const dowTotals = new Array(7).fill(0);
  const dowCounts = new Array(7).fill(0);
  for (const d of dailySpend) {
    const wd = new Date(d.day * 86400000).getUTCDay();
    dowTotals[wd] += d.total;
    dowCounts[wd] += 1;
  }
  // Monday-first ordering reads naturally for a week
  const dowOrder = [1, 2, 3, 4, 5, 6, 0];
  const dowAvg = dowOrder.map((wd) => ({
    label: DOW_SHORT[wd],
    avg: dowCounts[wd] ? dowTotals[wd] / dowCounts[wd] : 0,
  }));

  // --- items / stores / categories ---
  const costByItem = new Map();
  for (const r of purchases) {
    const item = (r.item || "").trim();
    if (!item) continue;
    costByItem.set(item, (costByItem.get(item) || 0) + n0(r.total_price));
  }
  const topItemsByCost = [...costByItem.entries()]
    .map(([item, total]) => ({ item, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const costByStore = new Map();
  for (const r of purchases) {
    const store = (r.store || "").trim();
    if (!store) continue;
    costByStore.set(store, (costByStore.get(store) || 0) + n0(r.total_price));
  }
  const topStoresByCost = [...costByStore.entries()]
    .map(([store, total]) => ({ store, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const costByCategory = new Map();
  for (const r of purchases) {
    const item = (r.item || "").trim();
    if (!item) continue;
    const c = categorize(item);
    costByCategory.set(c, (costByCategory.get(c) || 0) + n0(r.total_price));
  }
  // fixed slot order — keeps stack adjacency identical to the validated palette order
  const spendByCategory = CATEGORY_SLOTS
    .filter((s) => costByCategory.has(s.name))
    .map((s) => ({
      category: s.name, token: s.token,
      total: costByCategory.get(s.name),
      pct: totalSpent > 0 ? (costByCategory.get(s.name) / totalSpent) * 100 : 0,
    }));

  // --- price watch: same item + unit, unit price changed between trips ---
  const priceGroups = new Map();
  for (const r of purchases) {
    const item = (r.item || "").trim();
    const unit = (r.unit || "").trim().toLowerCase();
    const uc = num(r.unit_cost);
    const d = dayNum(r.date);
    if (!item || !Number.isFinite(uc) || uc <= 0 || !Number.isFinite(d)) continue;
    const key = item.toLowerCase() + "|" + unit;
    if (!priceGroups.has(key)) priceGroups.set(key, { item, unit: (r.unit || "").trim(), buys: [] });
    priceGroups.get(key).buys.push({ d, uc });
  }
  const priceWatch = [];
  for (const g of priceGroups.values()) {
    if (g.buys.length < 2) continue;
    g.buys.sort((a, b) => a.d - b.d);
    const first = g.buys[0], last = g.buys[g.buys.length - 1];
    if (first.d === last.d) continue;
    const changePct = ((last.uc - first.uc) / first.uc) * 100;
    if (Math.abs(changePct) < 0.5) continue; // stable prices aren't news
    priceWatch.push({
      item: g.item, unit: g.unit,
      firstCost: first.uc, lastCost: last.uc,
      firstDate: dayToIso(first.d), lastDate: dayToIso(last.d),
      changePct,
    });
  }
  priceWatch.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  const priceWatchTop = priceWatch.slice(0, 8);

  // --- meals ---
  const totalMeals = meals.length;
  const mealCosts = meals.map((r) => num(r.est_cost)).filter(Number.isFinite);
  const avgCostPerMeal = mealCosts.length
    ? mealCosts.reduce((s, x) => s + x, 0) / mealCosts.length : 0;

  const byType = new Map();
  for (const r of meals) {
    let t = (r.meal_type || "").trim().toLowerCase();
    if (t === "snacks") t = "snack";
    if (!t) continue;
    const c = num(r.est_cost);
    if (!Number.isFinite(c)) continue;
    const cur = byType.get(t) || { sum: 0, count: 0 };
    cur.sum += c; cur.count += 1;
    byType.set(t, cur);
  }
  const avgByMealType = MEAL_ORDER
    .filter((t) => byType.has(t))
    .map((t) => ({ type: t, avg: byType.get(t).sum / byType.get(t).count }));
  for (const [t, v] of byType) {
    if (!MEAL_ORDER.includes(t)) avgByMealType.push({ type: t, avg: v.sum / v.count });
  }

  const outsideAvgPerEvent = hasOutsideFood ? outsideFoodTotal / outsideFood.length : 0;
  const canCompareMealCost = avgCostPerMeal > 0 && hasOutsideFood;
  const eatingOutMultiplier = canCompareMealCost ? outsideAvgPerEvent / avgCostPerMeal : null;
  const moneySaved = canCompareMealCost
    ? totalMeals * (outsideAvgPerEvent - avgCostPerMeal) : null;

  // meals per calendar day + daily avg cost, for the trend + heatmap
  const mealsByDay = new Map(); // dayNum -> {count, sum, costs}
  for (const r of meals) {
    const d = dayNum(r.date);
    if (!Number.isFinite(d)) continue;
    if (!mealsByDay.has(d)) mealsByDay.set(d, { count: 0, sum: 0, n: 0 });
    const cur = mealsByDay.get(d);
    cur.count += 1;
    const c = num(r.est_cost);
    if (Number.isFinite(c)) { cur.sum += c; cur.n += 1; }
  }
  const mealDays = [...mealsByDay.keys()].sort((a, b) => a - b);
  const mealTrend = [];
  for (const d of mealDays) {
    const cur = mealsByDay.get(d);
    if (!cur.n) continue;
    const dayAvg = cur.sum / cur.n;
    // 7-day rolling mean of the daily averages (days with meals only)
    let wSum = 0, wN = 0;
    for (const d2 of mealDays) {
      if (d2 > d) break;
      if (d2 > d - 7) {
        const c2 = mealsByDay.get(d2);
        if (c2.n) { wSum += c2.sum / c2.n; wN += 1; }
      }
    }
    mealTrend.push({ date: dayToIso(d), dayAvg, rolling: wN ? wSum / wN : dayAvg });
  }

  // --- all tracked dates (any file) ---
  const allDayNums = new Set();
  for (const rows of [purchases, meals, outsideFood, waste, fun]) {
    for (const r of rows) {
      const d = dayNum(r.date);
      if (Number.isFinite(d)) allDayNums.add(d);
    }
  }
  const trackFirst = Math.min(...(allDayNums.size ? allDayNums : [NaN]));
  const trackLast = Math.max(...(allDayNums.size ? allDayNums : [NaN]));
  const daysTrackedCount = allDayNums.size;
  const dateRangeLabel = allDayNums.size
    ? (trackFirst === trackLast
        ? fmtDateShort(dayToIso(trackFirst))
        : `${fmtDateShort(dayToIso(trackFirst))} – ${fmtDateShort(dayToIso(trackLast))}`)
    : "";

  const avgSpendPerDay = daysTrackedCount ? foodTotal / daysTrackedCount : 0;
  const projectedMonthlySpend = avgSpendPerDay * 30;

  // --- cooking streak: consecutive days with ≥1 home-cooked meal,
  //     counted back from the latest tracked day (grace of 1 day) ---
  let cookStreak = 0;
  if (mealDays.length && Number.isFinite(trackLast)) {
    const mealDaySet = new Set(mealDays);
    let d = mealDaySet.has(trackLast) ? trackLast : trackLast - 1;
    while (mealDaySet.has(d)) { cookStreak += 1; d -= 1; }
  }

  // --- share of food events eaten at home ---
  const homeSharePct = (totalMeals + outsideFood.length) > 0
    ? (totalMeals / (totalMeals + outsideFood.length)) * 100 : null;

  // --- heatmap: meals per day across the full tracked range ---
  const heatmap = [];
  if (mealDays.length && Number.isFinite(trackFirst)) {
    for (let d = trackFirst; d <= trackLast; d++) {
      heatmap.push({ day: d, date: dayToIso(d), count: mealsByDay.get(d)?.count || 0 });
    }
  }

  // --- most-used ingredients (distinct meals each item appeared in) ---
  const mealsByItem = new Map();
  mealUsage.forEach((r, i) => {
    const item = (r.item || "").trim();
    if (!item) return;
    const key = (r.meal_id || "").trim() || `row${i}`;
    if (!mealsByItem.has(item)) mealsByItem.set(item, new Set());
    mealsByItem.get(item).add(key);
  });
  const topIngredients = [...mealsByItem.entries()]
    .map(([item, set]) => ({ item, count: set.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // --- waste ---
  const wasteValue = (r) => {
    const v = num(r.waste_value);
    return Number.isFinite(v) ? v : n0(r.qty_wasted) * n0(r.unit_cost);
  };
  const totalWaste = waste.reduce((s, r) => s + wasteValue(r), 0);
  const wastePct = totalSpent > 0 ? (totalWaste / totalSpent) * 100 : 0;
  const hasWaste = waste.length > 0;
  const wasteEvents = waste.map((r) => ({
    date: (r.date || "").trim(), item: (r.item || "").trim(),
    value: wasteValue(r), qty: (r.qty_wasted || "").trim(), unit: (r.unit || "").trim(),
  })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const wasteByItem = new Map();
  for (const r of waste) {
    const item = (r.item || "").trim();
    if (!item) continue;
    wasteByItem.set(item, (wasteByItem.get(item) || 0) + wasteValue(r));
  }
  const topWastedItems = [...wasteByItem.entries()]
    .map(([item, total]) => ({ item, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // --- inventory: active batches, lowest fraction-remaining first ---
  const activeInventoryAll = inventory
    .filter((r) => ["OPEN", "FUZZY"].includes(String(r.status || "").trim().toUpperCase()))
    .map((r) => {
      const purchased = num(r.qty_purchased);
      const remaining = num(r.qty_remaining);
      const pct = Number.isFinite(purchased) && purchased > 0 && Number.isFinite(remaining)
        ? (remaining / purchased) * 100 : null;
      // Fuzzy estimates can drift at/below 0 — that's an overshot portion
      // estimate, not a real negative quantity, so clamp what we display.
      const pctClamped = pct == null ? null : Math.max(0, Math.min(100, pct));
      const ageDays = Number.isFinite(trackLast) && Number.isFinite(dayNum(r.date_purchased))
        ? trackLast - dayNum(r.date_purchased) : null;
      const remainValue = Math.max(0, n0(r.qty_remaining)) * n0(r.unit_cost);
      return { ...r, pctRemaining: pctClamped, ageDays, remainValue, category: categorize(r.item) };
    })
    .sort((a, b) => {
      const pa = a.pctRemaining == null ? 101 : a.pctRemaining;
      const pb = b.pctRemaining == null ? 101 : b.pctRemaining;
      return pa - pb;
    });
  const lowStockCount = activeInventoryAll.filter((r) => r.pctRemaining != null && r.pctRemaining <= 20).length;
  const pantryValue = activeInventoryAll.reduce((s, r) => s + r.remainValue, 0);

  // fresh-category batches open 10+ days with plenty left — spoilage risk
  const agingBatches = activeInventoryAll
    .filter((r) => ["Produce", "Dairy & Eggs", "Protein"].includes(r.category))
    .filter((r) => r.ageDays != null && r.ageDays >= 10 && (r.pctRemaining == null || r.pctRemaining >= 40))
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 6);

  // --- fun analysis ---
  const funByDay = new Map();
  for (const r of fun) {
    const d = dayNum(r.date);
    if (!Number.isFinite(d)) continue;
    funByDay.set(d, (funByDay.get(d) || 0) + n0(r.cost));
  }
  let biggestFunNight = null;
  for (const [d, total] of funByDay) {
    if (!biggestFunNight || total > biggestFunNight.total) biggestFunNight = { date: dayToIso(d), total };
  }
  const funAvgPerEvent = hasFun ? funTotal / fun.length : 0;

  // --- unified activity feed ---
  const activity = [];
  const tripGroups = new Map();
  for (const r of purchases) {
    const trip = (r.trip_id || "").trim() || `${r.date}-${r.store}`;
    if (!tripGroups.has(trip)) tripGroups.set(trip, []);
    tripGroups.get(trip).push(r);
  }
  for (const [trip, rows] of tripGroups) {
    const first = rows[0];
    const total = rows.reduce((s, r) => s + n0(r.total_price), 0);
    activity.push({
      date: (first.date || "").trim(), type: "grocery",
      title: `${first.store || "Grocery"} trip — ${rows.length} item${rows.length === 1 ? "" : "s"}`,
      amount: total, sortKey: trip,
    });
  }
  for (const r of meals) {
    const c = num(r.est_cost);
    activity.push({
      date: (r.date || "").trim(), type: "meal",
      title: `${cap((r.meal_type || "").trim().toLowerCase())} — ${r.description || ""}`,
      amount: Number.isFinite(c) ? c : null, sortKey: r.meal_id || "",
    });
  }
  for (const r of outsideFood) {
    activity.push({
      date: (r.date || "").trim(), type: "outside",
      title: r.description || "Outside food",
      amount: n0(r.cost), sortKey: `${r.date}-${r.description}`,
    });
  }
  for (const r of waste) {
    activity.push({
      date: (r.date || "").trim(), type: "waste",
      title: `Wasted ${r.item || "item"}`,
      amount: -wasteValue(r), sortKey: r.batch_id || "",
    });
  }
  for (const r of fun) {
    activity.push({
      date: (r.date || "").trim(), type: "fun",
      title: r.description || "Fun",
      amount: n0(r.cost), sortKey: `${r.date}-${r.description}`,
    });
  }
  activity.sort((a, b) => {
    const d = String(b.date).localeCompare(String(a.date));
    if (d !== 0) return d;
    return String(b.sortKey).localeCompare(String(a.sortKey));
  });

  // recent meals for the meal log table
  const recentMeals = [...meals]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.meal_id).localeCompare(String(a.meal_id)))
    .slice(0, 12);

  return {
    totalSpent, totalTrips, avgSpendPerTrip,
    outsideFoodTotal, hasOutsideFood, foodTotal, outsideFoodPct, outsideCount: outsideFood.length,
    funTotal, hasFun, funEventsCount: fun.length, funAvgPerEvent, biggestFunNight,
    allSpendTotal, hasAnySpend,
    dailySpend, cumulativeSpend, weekSpend, prevWeekSpend, weekDelta, dowAvg,
    topItemsByCost, topStoresByCost, spendByCategory, priceWatch: priceWatchTop,
    totalMeals, avgCostPerMeal, avgByMealType, mealTrend, recentMeals,
    outsideAvgPerEvent, canCompareMealCost, eatingOutMultiplier, moneySaved,
    cookStreak, homeSharePct, heatmap, topIngredients,
    totalWaste, wastePct, hasWaste, wasteEvents, topWastedItems,
    activeInventory: activeInventoryAll, lowStockCount, pantryValue, agingBatches,
    avgSpendPerDay, projectedMonthlySpend, daysTrackedCount, dateRangeLabel,
    activity,
    hasPurchases: purchases.length > 0,
    hasMeals: meals.length > 0,
  };
}

/* ---- animation primitives ------------------------------------------ */

// animate a number counting up; instant under prefers-reduced-motion
function countUp(el, target, fmt, dur = 800) {
  if (!el) return;
  if (REDUCED || !Number.isFinite(target) || target === 0) {
    el.textContent = fmt(target || 0);
    return;
  }
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
    el.textContent = fmt(target * e);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// staggered card entrance on a view's first render (30–80ms per Emil's playbook)
function revealCards(viewEl) {
  const cards = viewEl.querySelectorAll("[data-reveal]");
  cards.forEach((c, i) => {
    if (c.hidden) return;
    c.style.animationDelay = Math.min(i * 45, 400) + "ms";
    c.classList.add("reveal");
  });
}

/* ---- chart theme layer --------------------------------------------- */

const charts = {}; // id -> Chart, so we can destroy on theme/range change

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}
function destroyAllCharts() {
  Object.keys(charts).forEach(destroyChart);
}

const BAR_MAX = 22; // thin marks, per the dataviz spec

function chartAnim() {
  if (REDUCED) return false;
  return {
    duration: 550,
    easing: "easeOutQuart",
    delay: (ctx) => (ctx.type === "data" && ctx.mode === "default"
      ? Math.min((ctx.dataIndex || 0) * 26, 320) : 0),
  };
}

function baseScales({ x = {}, y = {} } = {}) {
  const grid = token("--gridline");
  const baseline = token("--baseline");
  const muted = token("--text-3");
  const mk = (over) => ({
    grid: { color: grid, drawTicks: false, ...(over.grid || {}) },
    border: { color: baseline, display: over.border?.display ?? true },
    ticks: { color: muted, padding: 6, ...(over.ticks || {}) },
    ...over,
  });
  return { x: mk(x), y: mk(y) };
}

function tooltipStyle() {
  return {
    backgroundColor: token("--surface-3"),
    borderColor: token("--border-strong"),
    borderWidth: 1,
    titleColor: "#f7f8f8",
    bodyColor: "#a2a7b0",
    titleFont: { weight: 600 },
    padding: 10, cornerRadius: 10,
    boxWidth: 8, boxHeight: 8, usePointStyle: true, boxPadding: 4,
  };
}

function legendStyle() {
  return {
    display: true,
    position: "bottom",
    labels: {
      color: token("--text-2"),
      usePointStyle: true, pointStyle: "circle",
      boxWidth: 7, boxHeight: 7, padding: 14,
      font: { size: 12 },
    },
  };
}

// value label at each bar tip; measures so text never clips
const valueLabelPlugin = {
  id: "valueLabels",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.formatter) return;
    const { ctx, chartArea } = chart;
    const horizontal = chart.options.indexAxis === "y";
    ctx.save();
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const ink = token("--text-1");
    chart.getDatasetMeta(0).data.forEach((bar, i) => {
      const raw = chart.data.datasets[0].data[i];
      const label = opts.formatter(raw);
      const w = ctx.measureText(label).width;
      if (horizontal) {
        const outside = bar.x + 6 + w <= chartArea.right;
        ctx.textAlign = outside ? "left" : "right";
        ctx.fillStyle = outside ? ink : "#ffffff";
        ctx.fillText(label, outside ? bar.x + 6 : bar.x - 6, bar.y);
      } else {
        const above = bar.y - 8 >= chartArea.top;
        ctx.textAlign = "center";
        ctx.textBaseline = above ? "bottom" : "top";
        ctx.fillStyle = above ? ink : "#ffffff";
        ctx.fillText(label, bar.x, above ? bar.y - 6 : bar.y + 6);
      }
    });
    ctx.restore();
  },
};

// value label at the last point of a single-series line
const endLabelPlugin = {
  id: "endLabel",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.formatter) return;
    const data = chart.data.datasets[0].data;
    if (!data.length) return;
    const meta = chart.getDatasetMeta(0);
    const lastPoint = meta.data[meta.data.length - 1];
    if (!lastPoint) return;
    const label = opts.formatter(data[data.length - 1]);
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = token("--text-1");
    const w = ctx.measureText(label).width;
    const outside = lastPoint.x + 8 + w <= chartArea.right;
    ctx.textAlign = outside ? "left" : "right";
    ctx.fillText(label, outside ? lastPoint.x + 8 : lastPoint.x - 8, lastPoint.y);
    ctx.restore();
  },
};

function toggleChart(canvasId, emptyId, hasData) {
  const canvas = document.getElementById(canvasId);
  const empty = document.getElementById(emptyId);
  if (canvas) canvas.parentElement.style.display = hasData ? "" : "none";
  if (empty) empty.hidden = hasData;
  return hasData;
}

/* ---- shared table builder ------------------------------------------ */

function buildTable(containerId, columns, rows, emptyMsg) {
  const el = document.getElementById(containerId);
  if (!rows.length) {
    el.innerHTML = `<p class="empty">${esc(emptyMsg)}</p>`;
    return;
  }
  const head = columns.map((c) =>
    `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("");
  const body = rows.map((r) => "<tr>" + columns.map((c) => {
    const val = c.render ? c.render(r) : esc(r[c.key] ?? "");
    return `<td class="${c.num ? "num" : ""}">${val}</td>`;
  }).join("") + "</tr>").join("");
  el.innerHTML =
    `<div class="table-scroll"><table><thead><tr>${head}</tr></thead>` +
    `<tbody>${body}</tbody></table></div>`;
}

function statusPill(status) {
  const s = (status || "").trim();
  return s ? `<span class="pill pill--${esc(s.toLowerCase())}">${esc(s)}</span>` : "";
}

function levelBar(pct) {
  if (pct == null) return "";
  const clamped = Math.max(0, Math.min(100, pct));
  const cls = clamped <= 20 ? " bar-fill--low" : clamped <= 40 ? " bar-fill--warn" : "";
  return `<div class="bar-track"><span class="bar-fill${cls}" style="width:${clamped}%"></span></div>`;
}

function activityItemHtml(a, withDate) {
  const amountCls = a.amount != null && a.amount < 0 ? " activity-amount--neg" : "";
  const amountTxt = a.amount == null ? "—" : (a.amount < 0 ? "-" : "") + fmtMoney(Math.abs(a.amount));
  return `<div class="activity-item">
    <span class="activity-icon activity-icon--${a.type}" aria-hidden="true">${ICONS[a.type] || ""}</span>
    <div class="activity-main">
      <span class="activity-title">${esc(a.title)}</span>
      ${withDate ? `<span class="activity-date">${esc(fmtDateShort(a.date))}</span>` : ""}
    </div>
    <span class="activity-amount${amountCls}">${amountTxt}</span>
  </div>`;
}

/* =====================================================================
   VIEW RENDERERS
   ===================================================================== */

let CACHE = null;   // parsed CSV rows
let STATS = null;   // computed stats
let spendingRange = "all"; // "7" | "14" | "all"
let activityFilter = "all";

const setText = (id, txt) => {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
};

/* ---- overview ------------------------------------------------------- */

function renderHeroSparkline(s) {
  const el = document.getElementById("hero-spark");
  if (!el) return;
  const days = s.dailySpend.slice(-14);
  setText("hero-spark-label", days.length >= 2 ? "daily spend · last 14 days" : "");
  if (days.length < 2) { el.innerHTML = ""; return; }
  const w = 260, h = 76, pad = 4;
  const vals = days.map((d) => d.total);
  const max = Math.max(...vals, 0.01);
  const stepX = (w - pad * 2) / (vals.length - 1);
  const pts = vals.map((v, i) => [
    pad + i * stepX,
    h - pad - (v / max) * (h - pad * 2),
  ]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = pts[pts.length - 1];
  const area = `${pad},${h - pad} ${line} ${lastX.toFixed(1)},${h - pad}`;
  el.innerHTML =
    `<polyline class="spark-area" points="${area}"></polyline>` +
    `<polyline class="spark-line" points="${line}"></polyline>` +
    `<circle class="spark-dot" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.4"></circle>`;
  if (!REDUCED) {
    const lineEl = el.querySelector(".spark-line");
    try {
      const len = Math.ceil(lineEl.getTotalLength());
      lineEl.style.strokeDasharray = String(len);
      el.parentElement.style.setProperty("--spark-len", String(len));
      el.parentElement.classList.add("spark-draw");
    } catch (_e) { /* getTotalLength can throw pre-layout; skip the draw-in */ }
  }
}

function renderOverview() {
  const s = STATS;

  // hero
  countUp(document.getElementById("hero-value"), s.allSpendTotal, fmtMoney0, 900);
  setText("hero-sub", s.hasAnySpend
    ? `${fmtMoney0(s.totalSpent)} groceries · ${fmtMoney0(s.outsideFoodTotal)} eating out · ${fmtMoney0(s.funTotal)} fun — since ${s.dateRangeLabel.split("–")[0].trim()}`
    : "Log your first receipt to start tracking.");
  const deltaChip = document.getElementById("hero-delta");
  if (s.weekDelta != null && Math.abs(s.weekDelta) >= 0.5) {
    deltaChip.hidden = false;
    deltaChip.classList.toggle("is-up", s.weekDelta > 0);
    deltaChip.classList.toggle("is-down", s.weekDelta < 0);
    setText("hero-delta-text", `${Math.abs(s.weekDelta).toFixed(0)}% vs prior week`);
  } else {
    deltaChip.hidden = true;
  }
  renderHeroSparkline(s);

  // KPI tiles
  setText("kpi-groceries", s.hasPurchases ? fmtMoney0(s.totalSpent) : "—");
  setText("kpi-groceries-sub", s.hasPurchases
    ? `${s.totalTrips} trips · ${fmtMoney(s.avgSpendPerTrip)} avg` : "");

  setText("kpi-outside", s.hasOutsideFood ? fmtMoney0(s.outsideFoodTotal) : "—");
  setText("kpi-outside-sub", s.hasOutsideFood
    ? `${fmtPct(s.outsideFoodPct)} of food $ · ${s.outsideCount} events` : "");

  setText("kpi-fun", s.hasFun ? fmtMoney0(s.funTotal) : "—");
  setText("kpi-fun-sub", s.hasFun ? `${s.funEventsCount} events` : "");

  setText("kpi-avgday", s.daysTrackedCount ? fmtMoney(s.avgSpendPerDay) : "—");
  setText("kpi-avgday-sub", s.daysTrackedCount ? `≈${fmtMoney0(s.projectedMonthlySpend)} / 30 days on food` : "");

  setText("kpi-waste", s.hasPurchases ? fmtPct(s.wastePct) : "—");
  const wasteSub = document.getElementById("kpi-waste-sub");
  wasteSub.textContent = s.hasWaste ? `${fmtMoney(s.totalWaste)} wasted` : (s.hasPurchases ? "no waste logged" : "");
  wasteSub.classList.toggle("tile__sub--good", s.hasPurchases && !s.hasWaste);

  setText("kpi-streak", s.cookStreak ? String(s.cookStreak) : "—");
  setText("kpi-streak-sub", s.cookStreak ? `day${s.cookStreak === 1 ? "" : "s"} cooking at home` : "");

  setText("kpi-pantry", s.activeInventory.length ? fmtMoney0(s.pantryValue) : "—");
  setText("kpi-pantry-sub", s.activeInventory.length
    ? `across ${s.activeInventory.length} open batches` : "");

  const lowTile = document.getElementById("tile-lowstock");
  lowTile.hidden = !(s.lowStockCount > 0);
  if (s.lowStockCount > 0) setText("kpi-lowstock", String(s.lowStockCount));

  // duel: home vs out
  const homeVal = s.totalMeals ? s.avgCostPerMeal : 0;
  const outVal = s.hasOutsideFood ? s.outsideAvgPerEvent : 0;
  const maxVal = Math.max(homeVal, outVal, 0.01);
  setText("duel-home-val", s.totalMeals ? fmtMoney(homeVal) : "—");
  setText("duel-out-val", s.hasOutsideFood ? fmtMoney(outVal) : "—");
  requestAnimationFrame(() => {
    document.getElementById("duel-home-bar").style.width = (homeVal / maxVal) * 100 + "%";
    document.getElementById("duel-out-bar").style.width = (outVal / maxVal) * 100 + "%";
  });
  const note = document.getElementById("duel-note");
  if (s.canCompareMealCost) {
    const mult = s.eatingOutMultiplier;
    note.innerHTML = mult >= 1
      ? `Eating out costs <strong>${mult.toFixed(1)}×</strong> more per meal than cooking at home.`
      : `Eating out currently costs <strong>${(1 / mult).toFixed(1)}× less</strong> per meal than cooking.`;
  } else {
    note.textContent = "Log a home-cooked meal and an outside food event to see the comparison.";
  }
  const saved = document.getElementById("duel-saved");
  if (s.canCompareMealCost && s.moneySaved > 0) {
    saved.hidden = false;
    saved.textContent = `≈${fmtMoney0(s.moneySaved)} saved by cooking ${s.totalMeals} meals`;
  } else {
    saved.hidden = true;
  }

  // recent activity preview
  const el = document.getElementById("ov-activity");
  if (!s.activity.length) {
    el.innerHTML = `<p class="empty">Log a receipt, meal, or night out to see activity here.</p>`;
  } else {
    el.innerHTML = s.activity.slice(0, 8).map((a) => activityItemHtml(a, true)).join("");
  }
}

/* ---- spending ------------------------------------------------------- */

function sliceRange(arr) {
  if (spendingRange === "all") return arr;
  const n = parseInt(spendingRange, 10);
  return arr.slice(-n);
}

function renderDailyChart() {
  const s = STATS;
  const data = sliceRange(s.dailySpend);
  destroyChart("daily");
  if (!toggleChart("chart-daily", "empty-daily", data.length > 0)) return;
  const surface = token("--surface-1");
  const mkBar = (label, key, colorToken) => ({
    label,
    data: data.map((d) => d[key]),
    backgroundColor: token(colorToken),
    borderColor: surface, borderWidth: 1.5, // 2px-ish surface gap between stacked segments
    borderRadius: 3, borderSkipped: false,
    maxBarThickness: BAR_MAX, stack: "spend",
  });
  charts.daily = new Chart(document.getElementById("chart-daily"), {
    type: "bar",
    data: {
      labels: data.map((d) => fmtDateShort(d.date)),
      datasets: [
        mkBar("Groceries", "groceries", "--series-1"),
        mkBar("Outside food", "outside", "--series-2"),
        mkBar("Fun", "fun", "--series-3"),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: chartAnim(),
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: legendStyle(),
        tooltip: {
          ...tooltipStyle(),
          callbacks: { label: (i) => ` ${i.dataset.label}: ${fmtMoney(i.parsed.y)}` },
        },
      },
      scales: baseScales({
        x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmtMoney0(v) } },
      }),
    },
  });
}

function renderCumulativeChart() {
  const s = STATS;
  const all = sliceRange(s.dailySpend);
  destroyChart("cumulative");
  if (!toggleChart("chart-cumulative", "empty-cumulative", all.length > 0)) return;
  let run = 0;
  const data = all.map((d) => { run += d.total; return { date: d.date, running: run }; });
  const c1 = token("--series-1");
  const surface = token("--surface-1");
  charts.cumulative = new Chart(document.getElementById("chart-cumulative"), {
    type: "line",
    data: {
      labels: data.map((d) => fmtDateShort(d.date)),
      datasets: [{
        data: data.map((d) => d.running),
        borderColor: c1,
        backgroundColor: c1 + "1a", // ~10% wash per the mark spec
        fill: true,
        borderWidth: 2,
        cubicInterpolationMode: "monotone", tension: 0.35,
        pointRadius: (ctx) => (ctx.dataIndex === ctx.dataset.data.length - 1 ? 4 : 0),
        pointHoverRadius: 5,
        pointBackgroundColor: c1,
        pointBorderColor: surface, pointBorderWidth: 2,
        pointHitRadius: 24,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: REDUCED ? false : { duration: 650, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      layout: { padding: { right: 56, top: 8 } },
      plugins: {
        legend: { display: false }, // single series — the title names it
        tooltip: { ...tooltipStyle(), callbacks: { label: (i) => ` ${fmtMoney(i.parsed.y)}` } },
        endLabel: { formatter: fmtMoney0 },
      },
      scales: baseScales({
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: { beginAtZero: true, ticks: { callback: (v) => fmtMoney0(v) } },
      }),
    },
    plugins: [endLabelPlugin],
  });
}

function renderDowChart() {
  const s = STATS;
  destroyChart("dow");
  const hasData = s.dowAvg.some((d) => d.avg > 0);
  if (!toggleChart("chart-dow", "empty-dow", hasData)) return;
  charts.dow = new Chart(document.getElementById("chart-dow"), {
    type: "bar",
    data: {
      labels: s.dowAvg.map((d) => d.label),
      datasets: [{
        data: s.dowAvg.map((d) => d.avg),
        backgroundColor: token("--series-1"),
        borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom",
        maxBarThickness: BAR_MAX,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: chartAnim(),
      layout: { padding: { top: 20 } },
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipStyle(), callbacks: { label: (i) => ` avg ${fmtMoney(i.parsed.y)}` } },
        valueLabels: { formatter: fmtMoney0 },
      },
      scales: baseScales({
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: (v) => fmtMoney0(v) } },
      }),
    },
    plugins: [valueLabelPlugin],
  });
}

function renderCategoryChart() {
  const s = STATS;
  destroyChart("category");
  const legendEl = document.getElementById("legend-category");
  legendEl.hidden = s.spendByCategory.length === 0;
  legendEl.innerHTML = s.spendByCategory.map((c) => `<li class="legend-list__item">
      <span class="key" style="background:${token(c.token)}"></span>
      <span class="legend-list__name">${esc(c.category)}</span>
      <span class="legend-list__value">${fmtMoney0(c.total)} · ${c.pct.toFixed(0)}%</span>
    </li>`).join("");
  if (!toggleChart("chart-category", "empty-category", s.spendByCategory.length > 0)) return;
  const surface = token("--surface-1");
  const datasets = s.spendByCategory.map((c) => ({
    label: c.category,
    data: [c.total],
    backgroundColor: token(c.token),
    borderColor: surface, borderWidth: 1.5, // surface gap between segments
    borderRadius: 3, borderSkipped: false,
    maxBarThickness: BAR_MAX,
    stack: "category",
    _pct: c.pct,
  }));
  charts.category = new Chart(document.getElementById("chart-category"), {
    type: "bar",
    data: { labels: [""], datasets },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      animation: chartAnim(),
      plugins: {
        legend: { display: false }, // HTML legend below carries identity
        tooltip: {
          ...tooltipStyle(),
          callbacks: { label: (i) => ` ${i.dataset.label}: ${fmtMoney(i.parsed.x)} (${i.dataset._pct.toFixed(0)}%)` },
        },
      },
      scales: baseScales({
        x: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmtMoney0(v) } },
        y: { stacked: true, display: false, grid: { display: false } },
      }),
    },
  });
}

// keep long category labels readable at narrow widths — trailing ellipsis,
// never a mid-word clip; tooltips still carry the full name
function truncTick(v) {
  const label = this.getLabelForValue(v);
  const max = this.chart.width < 520 ? 16 : 24;
  return label.length > max ? label.slice(0, max - 1) + "…" : label;
}

function hBarChart(id, canvasId, emptyId, rows, labelKey, valueKey, fmt) {
  destroyChart(id);
  if (!toggleChart(canvasId, emptyId, rows.length > 0)) return;
  charts[id] = new Chart(document.getElementById(canvasId), {
    type: "bar",
    data: {
      labels: rows.map((r) => r[labelKey]),
      datasets: [{
        data: rows.map((r) => r[valueKey]),
        backgroundColor: token("--series-1"),
        borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: "left",
        maxBarThickness: BAR_MAX,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      animation: chartAnim(),
      layout: { padding: { right: 56 } },
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipStyle(), callbacks: { label: (i) => ` ${fmt(i.parsed.x)}` } },
        valueLabels: { formatter: fmt },
      },
      scales: baseScales({
        x: { beginAtZero: true, ticks: { callback: (v) => (fmt === fmtMoney ? fmtMoney0(v) : v) } },
        y: { grid: { display: false }, ticks: { callback: truncTick } },
      }),
    },
    plugins: [valueLabelPlugin],
  });
}

function renderPriceWatch() {
  const s = STATS;
  buildTable("table-pricewatch",
    [
      { key: "item", label: "Item" },
      { label: "Then", num: true, render: (r) => `${fmtMoney(r.firstCost)}<span class="tile__sub">/${esc(r.unit || "unit")}</span>` },
      { label: "Now", num: true, render: (r) => `${fmtMoney(r.lastCost)}<span class="tile__sub">/${esc(r.unit || "unit")}</span>` },
      { label: "Change", num: true, render: (r) => {
          const up = r.changePct > 0.5, down = r.changePct < -0.5;
          const cls = up ? "delta--up" : down ? "delta--down" : "delta--flat";
          const sign = up ? "+" : "";
          return `<span class="delta ${cls}">${sign}${r.changePct.toFixed(0)}%</span>`;
        } },
    ],
    s.priceWatch,
    "No unit-price changes between repeat purchases yet.");
}

function renderFun() {
  const s = STATS;
  const emptyEl = document.getElementById("empty-fun");
  emptyEl.hidden = s.hasFun;
  setText("fun-total", s.hasFun ? fmtMoney0(s.funTotal) : "—");
  setText("fun-events", s.hasFun ? String(s.funEventsCount) : "—");
  setText("fun-biggest", s.biggestFunNight ? fmtMoney0(s.biggestFunNight.total) : "—");
  setText("fun-biggest-sub", s.biggestFunNight ? fmtDateShort(s.biggestFunNight.date) : "");
  setText("fun-avg", s.hasFun ? fmtMoney(s.funAvgPerEvent) : "—");
}

function renderSpending() {
  const s = STATS;
  setText("spending-sub", s.dateRangeLabel
    ? `${s.dateRangeLabel} · every tracked dollar`
    : "Every tracked dollar — groceries, eating out, fun");
  renderDailyChart();
  renderCumulativeChart();
  renderDowChart();
  renderCategoryChart();
  hBarChart("stores", "chart-stores", "empty-stores", s.topStoresByCost, "store", "total", fmtMoney);
  hBarChart("topitems", "chart-topitems", "empty-topitems", s.topItemsByCost, "item", "total", fmtMoney);
  renderPriceWatch();
  renderFun();
}

/* ---- meals ---------------------------------------------------------- */

function renderMealTrendChart() {
  const s = STATS;
  destroyChart("mealtrend");
  if (!toggleChart("chart-mealtrend", "empty-mealtrend", s.mealTrend.length > 1)) return;
  const gray = token("--text-3");
  const c1 = token("--series-1");
  const surface = token("--surface-1");
  charts.mealtrend = new Chart(document.getElementById("chart-mealtrend"), {
    type: "line",
    data: {
      labels: s.mealTrend.map((d) => fmtDateShort(d.date)),
      datasets: [
        {
          label: "7-day average",
          data: s.mealTrend.map((d) => d.rolling),
          borderColor: c1, backgroundColor: c1,
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
          pointHitRadius: 20,
          cubicInterpolationMode: "monotone", tension: 0.35,
        },
        {
          label: "Daily average",
          data: s.mealTrend.map((d) => d.dayAvg),
          borderColor: "transparent", backgroundColor: gray,
          showLine: false,
          pointRadius: 3, pointHoverRadius: 5, pointHitRadius: 20,
          pointBorderColor: surface, pointBorderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: REDUCED ? false : { duration: 650, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: legendStyle(),
        tooltip: { ...tooltipStyle(), callbacks: { label: (i) => ` ${i.dataset.label}: ${fmtMoney(i.parsed.y)}` } },
      },
      scales: baseScales({
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: { beginAtZero: true, ticks: { callback: (v) => fmtMoney(v) } },
      }),
    },
  });
}

function renderMealTypeChart() {
  const s = STATS;
  destroyChart("mealtype");
  if (!toggleChart("chart-mealtype", "empty-mealtype", s.avgByMealType.length > 0)) return;
  charts.mealtype = new Chart(document.getElementById("chart-mealtype"), {
    type: "bar",
    data: {
      labels: s.avgByMealType.map((d) => cap(d.type)),
      datasets: [{
        data: s.avgByMealType.map((d) => d.avg),
        backgroundColor: token("--series-1"), // nominal categories → one hue
        borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom",
        maxBarThickness: 30,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: chartAnim(),
      layout: { padding: { top: 20 } },
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipStyle(), callbacks: { label: (i) => ` ${fmtMoney(i.parsed.y)}` } },
        valueLabels: { formatter: fmtMoney },
      },
      scales: baseScales({
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { stepSize: 1, callback: (v) => fmtMoney0(v) } },
      }),
    },
    plugins: [valueLabelPlugin],
  });
}

function renderHeatmap() {
  const s = STATS;
  const grid = document.getElementById("heatmap");
  const legend = document.getElementById("heatmap-legend");
  const empty = document.getElementById("empty-heatmap");
  const has = s.heatmap.length > 0;
  empty.hidden = has;
  grid.style.display = has ? "" : "none";
  legend.style.display = has ? "" : "none";
  if (!has) { grid.innerHTML = ""; legend.innerHTML = ""; return; }

  const level = (c) => (c <= 0 ? 0 : c === 1 ? 1 : c === 2 ? 2 : c === 3 ? 3 : 4);
  const byDay = new Map(s.heatmap.map((d) => [d.day, d]));
  const first = s.heatmap[0].day;
  const last = s.heatmap[s.heatmap.length - 1].day;
  // pad to full Sunday-started weeks
  const firstDow = new Date(first * 86400000).getUTCDay();
  const start = first - firstDow;
  const weeks = Math.ceil((last - start + 1) / 7);

  let html = "";
  // left gutter: weekday labels (rows: month header + 7 days)
  html += `<div class="heatmap__month"></div>`;
  for (let r = 0; r < 7; r++) {
    html += `<div class="heatmap__dow">${r === 1 ? "Mon" : r === 3 ? "Wed" : r === 5 ? "Fri" : ""}</div>`;
  }
  let lastMonth = -1;
  let cellIdx = 0;
  for (let w = 0; w < weeks; w++) {
    const weekStart = start + w * 7;
    const p = dateParts(dayToIso(weekStart <= last ? Math.max(weekStart, first) : last));
    let monthLabel = "";
    if (p && p.mo !== lastMonth) { monthLabel = MONTHS[p.mo - 1]; lastMonth = p.mo; }
    html += `<div class="heatmap__month">${monthLabel}</div>`;
    for (let r = 0; r < 7; r++) {
      const d = weekStart + r;
      const cell = byDay.get(d);
      if (!cell) {
        html += `<div class="heatmap__cell heatmap__cell--void"></div>`;
      } else {
        const lv = level(cell.count);
        const delay = REDUCED ? "" : `style="animation-delay:${Math.min(cellIdx * 14, 500)}ms"`;
        html += `<div class="heatmap__cell${lv ? ` heatmap__cell--l${lv}` : ""}" ${delay}
          title="${esc(fmtDateShort(cell.date))} — ${cell.count} meal${cell.count === 1 ? "" : "s"}"></div>`;
        cellIdx++;
      }
    }
  }
  grid.innerHTML = html;
  legend.innerHTML = `<span>fewer</span>
    <div class="heatmap__cell"></div>
    <div class="heatmap__cell heatmap__cell--l1"></div>
    <div class="heatmap__cell heatmap__cell--l2"></div>
    <div class="heatmap__cell heatmap__cell--l3"></div>
    <div class="heatmap__cell heatmap__cell--l4"></div>
    <span>more</span>`;
}

function renderMeals() {
  const s = STATS;
  setText("meals-sub", s.hasMeals
    ? `${s.dateRangeLabel} · tracked to the ingredient`
    : "Home cooking, tracked to the ingredient");

  countUp(document.getElementById("meals-count"), s.totalMeals, (v) => String(Math.round(v)), 600);
  setText("meals-count-sub", s.dateRangeLabel);
  setText("meals-avg", s.totalMeals ? fmtMoney(s.avgCostPerMeal) : "—");
  setText("meals-share", s.homeSharePct != null ? s.homeSharePct.toFixed(0) + "%" : "—");
  setText("meals-share-sub", s.homeSharePct != null
    ? `${s.totalMeals} home · ${s.outsideCount} out` : "");
  setText("meals-streak", s.cookStreak ? String(s.cookStreak) : "—");
  setText("meals-streak-sub", s.cookStreak ? `consecutive day${s.cookStreak === 1 ? "" : "s"}` : "");

  renderMealTrendChart();
  renderMealTypeChart();
  renderHeatmap();
  hBarChart("ingredients", "chart-ingredients", "empty-ingredients",
    STATS.topIngredients, "item", "count", (v) => Math.round(v) + "×");

  buildTable("table-meals",
    [
      { label: "Date", render: (r) => `<span class="tile__sub cell-nowrap">${esc(fmtDateShort(r.date))}</span>` },
      { label: "Type", render: (r) => esc(cap((r.meal_type || "").trim())) },
      { key: "description", label: "Meal" },
      { label: "Est.", num: true, render: (r) => {
          const c = num(r.est_cost);
          return Number.isFinite(c) ? fmtMoney(c) : "—";
        } },
    ],
    s.recentMeals,
    "Log your first meal to see it here.");
}

/* ---- kitchen -------------------------------------------------------- */

function renderKitchen() {
  const s = STATS;

  setText("kit-open", s.activeInventory.length ? String(s.activeInventory.length) : "—");
  setText("kit-open-sub", s.activeInventory.length
    ? `${s.activeInventory.filter((r) => String(r.status).trim().toUpperCase() === "FUZZY").length} tracked as estimates` : "");
  setText("kit-value", s.activeInventory.length ? fmtMoney0(s.pantryValue) : "—");
  setText("kit-low", String(s.lowStockCount));
  setText("kit-waste", s.hasWaste ? fmtMoney(s.totalWaste) : "$0");
  setText("kit-waste-sub", s.hasPurchases ? `${fmtPct(s.wastePct)} of grocery spend` : "");

  // pantry list — batches with real stock lead; near-empty fuzzy estimates are
  // portion-tracking drift, not confirmed empties, so they fold into one line
  const invEl = document.getElementById("inv-list");
  if (!s.activeInventory.length) {
    invEl.innerHTML = `<p class="empty">No open inventory — log your first receipt.</p>`;
  } else {
    const nearEmpty = s.activeInventory.filter((r) => r.pctRemaining != null && r.pctRemaining < 5);
    const stocked = s.activeInventory.filter((r) => !(r.pctRemaining != null && r.pctRemaining < 5));
    const LIMIT = 14;
    const shown = stocked.slice(0, LIMIT);
    const more = stocked.length - shown.length;
    let html = shown.map((r) => {
      const q = num(r.qty_remaining);
      const qTxt = Number.isFinite(q) && q < 0 ? "~0" : esc(r.qty_remaining ?? "");
      const age = r.ageDays != null ? `${r.ageDays}d old` : "";
      const meta = [esc(r.store || ""), age].filter(Boolean).join(" · ");
      return `<div class="inv-row">
        <div class="inv-row__name">
          <div class="inv-row__item">${esc(r.item)}</div>
          <div class="inv-row__meta">${meta}</div>
        </div>
        ${levelBar(r.pctRemaining)}
        <div class="inv-row__qty">${qTxt} ${esc(r.unit ?? "")}</div>
        <div class="inv-row__pill">${statusPill(r.status)}</div>
      </div>`;
    }).join("");
    if (more > 0) {
      html += `<p class="table-more">+${more} more open batch${more === 1 ? "" : "es"} — see <code>inventory.csv</code></p>`;
    }
    if (nearEmpty.length) {
      html += `<p class="table-more">≈ Empty by the estimates (unconfirmed): ${nearEmpty.map((r) => esc(r.item)).join(", ")}</p>`;
    }
    invEl.innerHTML = html || `<p class="empty">No open inventory — log your first receipt.</p>`;
  }

  // use soon
  const agingEl = document.getElementById("aging-list");
  if (!s.agingBatches.length) {
    agingEl.innerHTML = `<p class="empty">Nothing fresh is sitting around. Nice.</p>`;
  } else {
    agingEl.innerHTML = s.agingBatches.map((r) => `<div class="inv-row" style="grid-template-columns: minmax(0,1.5fr) minmax(80px,1fr) 90px;">
      <div class="inv-row__name">
        <div class="inv-row__item">${esc(r.item)}</div>
        <div class="inv-row__meta">opened ${esc(fmtDateShort(r.date_purchased))} · ${r.ageDays} days ago</div>
      </div>
      ${levelBar(r.pctRemaining)}
      <div class="inv-row__qty">${fmtMoney(r.remainValue)} left</div>
    </div>`).join("");
  }

  // waste log
  const wasteEl = document.getElementById("waste-list");
  if (!s.wasteEvents.length) {
    wasteEl.innerHTML = `<p class="empty">No waste logged. Keep it that way.</p>`;
  } else {
    wasteEl.innerHTML = s.wasteEvents.map((w) => activityItemHtml({
      type: "waste",
      title: `${w.item}${w.qty ? ` — ${w.qty} ${w.unit}` : ""}`,
      amount: -w.value,
      date: w.date,
    }, true)).join("");
  }
}

/* ---- activity ------------------------------------------------------- */

function renderActivity() {
  const s = STATS;
  const el = document.getElementById("activity-feed");
  const rows = activityFilter === "all"
    ? s.activity
    : s.activity.filter((a) => a.type === activityFilter);
  if (!rows.length) {
    el.innerHTML = `<p class="empty">Nothing here yet.</p>`;
    return;
  }
  const LIMIT = 120;
  const shown = rows.slice(0, LIMIT);
  let html = "";
  let lastDate = null;
  for (const a of shown) {
    if (a.date !== lastDate) {
      html += `<div class="feed-date">${esc(fmtDateShort(a.date))}</div>`;
      lastDate = a.date;
    }
    html += activityItemHtml(a, false);
  }
  if (rows.length > LIMIT) {
    html += `<p class="table-more">+${rows.length - LIMIT} older entries in the CSVs</p>`;
  }
  el.innerHTML = html;
}

/* =====================================================================
   ROUTER + ORCHESTRATION
   ===================================================================== */

const renderedViews = new Set();
let activeView = null;

const VIEW_RENDERERS = {
  overview: renderOverview,
  spending: renderSpending,
  meals: renderMeals,
  kitchen: renderKitchen,
  activity: renderActivity,
};

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, "").trim();
  return VIEW_ORDER.includes(name) ? name : "overview";
}

function activateView(name) {
  if (name === activeView) return;
  const prevIdx = VIEW_ORDER.indexOf(activeView);
  const nextIdx = VIEW_ORDER.indexOf(name);

  document.querySelectorAll(".view").forEach((v) => {
    v.classList.remove("is-active", "view-in", "view-in-back");
  });
  const el = document.getElementById("view-" + name);
  el.classList.add("is-active");
  if (activeView !== null) {
    // direction-aware entrance: forward slides from the right, back from the left
    el.classList.add(prevIdx !== -1 && nextIdx < prevIdx ? "view-in-back" : "view-in");
  }

  document.querySelectorAll("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === name;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  activeView = name;
  window.scrollTo(0, 0);

  if (STATS && !renderedViews.has(name)) {
    VIEW_RENDERERS[name]();
    renderedViews.add(name);
    revealCards(el);
  }
}

function rerenderActive() {
  destroyAllCharts();
  renderedViews.clear();
  if (STATS && activeView) {
    VIEW_RENDERERS[activeView]();
    renderedViews.add(activeView);
  }
}

/* ---- last updated --------------------------------------------------- */

function renderLastUpdated(loaded) {
  const stamps = Object.values(loaded)
    .map((d) => d.lastModified)
    .filter(Boolean)
    .map((s) => new Date(s))
    .filter((d) => !isNaN(d));
  if (!stamps.length) return;
  const latest = new Date(Math.max(...stamps.map((d) => d.getTime())));
  const txt = "Updated " + latest.toLocaleDateString(undefined,
    { year: "numeric", month: "short", day: "numeric" });
  document.querySelectorAll("[data-updated]").forEach((el) => {
    el.textContent = txt;
    el.hidden = false;
  });
}

/* ---- init ----------------------------------------------------------- */

function wireControls() {
  // spending range segmented control
  const seg = document.getElementById("range-seg");
  seg.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg__btn");
    if (!btn) return;
    spendingRange = btn.dataset.range;
    seg.querySelectorAll(".seg__btn").forEach((b) => b.classList.toggle("is-active", b === btn));
    renderDailyChart();
    renderCumulativeChart();
  });

  // activity filter chips
  const filters = document.getElementById("activity-filters");
  filters.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip--filter");
    if (!chip) return;
    activityFilter = chip.dataset.filter;
    filters.querySelectorAll(".chip--filter").forEach((c) => c.classList.toggle("is-active", c === chip));
    renderActivity();
  });
}

async function init() {
  const entries = await Promise.all(
    Object.entries(CSV_FILES).map(async ([key, path]) => [key, await loadCsv(path)])
  );
  const loaded = Object.fromEntries(entries);
  CACHE = Object.fromEntries(entries.map(([k, v]) => [k, v.rows]));
  STATS = computeStats(CACHE);

  Chart.defaults.font.family = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
  Chart.defaults.font.size = 11.5;
  Chart.defaults.color = token("--text-3");

  renderLastUpdated(loaded);
  wireControls();

  // initial route (renders the active view; other views render lazily on first visit)
  activateView(currentRoute());
  const initial = document.getElementById("view-" + activeView);
  window.addEventListener("hashchange", () => activateView(currentRoute()));

  // re-render when the OS theme flips so chart tokens stay in sync
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => { Chart.defaults.color = token("--text-3"); rerenderActive(); };
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

document.addEventListener("DOMContentLoaded", init);
