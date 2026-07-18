/* =====================================================================
   Grocery Tracker — static dashboard
   Reads the CSVs under docs/data/, computes every stat in the browser,
   and renders KPI tiles, charts, and tables. No build, no server code.
   ===================================================================== */

const CSV_FILES = {
  purchases:  "data/purchases.csv",
  meals:      "data/meals.csv",
  mealUsage:  "data/meal_usage.csv",
  waste:      "data/waste.csv",
  inventory:  "data/inventory.csv",
  outsideFood: "data/outside_food.csv",
};

const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Lightweight keyword classifier — the CSVs carry no category column, so this
// infers one from the item name. Order matters: earlier rules win (e.g. "sauce"
// must be checked before "cheese" so "Pasta Sauce" doesn't land in Dairy).
const CATEGORY_RULES = [
  { name: "Protein", keywords: ["chicken", "beef", "turkey", "pork", "fish", "salmon", "shrimp", "tofu", "sausage", "bacon", "thigh", "breast"] },
  { name: "Produce", keywords: ["carrot", "mandarin", "apple", "onion", "pepper", "spinach", "salad", "banana", "lettuce", "tomato", "orange", "grape", "berry", "potato", "cucumber", "fruit", "vegetable"] },
  { name: "Grains & Pantry", keywords: ["pasta", "rice", "cereal", "bagel", "tortilla", "bread", "sauce", "garlic", "oil", "peanut butter", "jar", "flour", "oat"] },
  { name: "Dairy & Eggs", keywords: ["milk", "cheese", "egg", "yogurt"] },
  { name: "Snacks & Treats", keywords: ["cookie", "oreo", "ice cream", "chip", "candy", "chocolate", "cracker", "soda", "juice"] },
];
const CATEGORY_OTHER = "Other";
// Fixed name → color-slot mapping, independent of sort order — a category
// keeps its color even if its rank by spend changes week to week.
const CATEGORY_COLOR_SLOTS = {
  "Protein": "--series-1",
  "Produce": "--series-2",
  "Grains & Pantry": "--series-3",
  "Dairy & Eggs": "--series-4",
  "Snacks & Treats": "--series-5",
  [CATEGORY_OTHER]: "--series-6",
};
function categorize(itemName) {
  const s = String(itemName || "").toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => s.includes(k))) return rule.name;
  }
  return CATEGORY_OTHER;
}

/* ---- tiny helpers -------------------------------------------------- */

// Parse a numeric cell that may carry "$", ",", "%", "/unit", etc.
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

// Parse a "YYYY-MM-DD" string without going through Date() timezone shifts.
function fmtDateShort(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
  if (!m) return dateStr || "";
  const mon = MONTHS[parseInt(m[2], 10) - 1] || m[2];
  return `${mon} ${parseInt(m[3], 10)}`;
}

// read a design token off :root so charts match light/dark
function token(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

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
  const { purchases, meals, mealUsage, waste, inventory, outsideFood } = data;

  // --- purchases / trips ---
  const totalSpent = purchases.reduce((s, r) => s + n0(r.total_price), 0);

  const tripIds = new Set(purchases.map((r) => (r.trip_id || "").trim()).filter(Boolean));
  const tripDates = new Set(purchases.map((r) => (r.date || "").trim()).filter(Boolean));
  const totalTrips = tripIds.size || tripDates.size;
  const avgSpendPerTrip = totalTrips ? totalSpent / totalTrips : 0;

  // --- outside food ---
  const outsideFoodTotal = outsideFood.reduce((s, r) => s + n0(r.cost), 0);
  const hasOutsideFood = outsideFood.length > 0;
  const foodTotal = totalSpent + outsideFoodTotal;
  const outsideFoodPct = foodTotal > 0 ? (outsideFoodTotal / foodTotal) * 100 : 0;

  // daily spend, groceries vs outside food
  const groceriesByDate = new Map();
  for (const r of purchases) {
    const d = (r.date || "").trim();
    if (!d) continue;
    groceriesByDate.set(d, (groceriesByDate.get(d) || 0) + n0(r.total_price));
  }
  const outsideByDate = new Map();
  for (const r of outsideFood) {
    const d = (r.date || "").trim();
    if (!d) continue;
    outsideByDate.set(d, (outsideByDate.get(d) || 0) + n0(r.cost));
  }
  const allSpendDates = new Set([...groceriesByDate.keys(), ...outsideByDate.keys()]);
  const dailySpend = [...allSpendDates].sort().map((date) => ({
    date,
    groceries: groceriesByDate.get(date) || 0,
    outside: outsideByDate.get(date) || 0,
  }));

  // top items by cost
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

  // spending by category (part-to-whole) — keyword-classified from item name
  const costByCategory = new Map();
  for (const r of purchases) {
    const item = (r.item || "").trim();
    if (!item) continue;
    const cat = categorize(item);
    costByCategory.set(cat, (costByCategory.get(cat) || 0) + n0(r.total_price));
  }
  const spendByCategory = [...costByCategory.entries()]
    .map(([category, total]) => ({ category, total, pct: totalSpent > 0 ? (total / totalSpent) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);

  // cumulative food spend (groceries + outside food), running total by date
  let running = 0;
  const cumulativeSpend = [...allSpendDates].sort().map((date) => {
    running += (groceriesByDate.get(date) || 0) + (outsideByDate.get(date) || 0);
    return { date, total: running };
  });

  // --- meals ---
  const totalMeals = meals.length;
  const mealCosts = meals.map((r) => num(r.est_cost)).filter(Number.isFinite);
  const avgCostPerMeal = mealCosts.length
    ? mealCosts.reduce((s, x) => s + x, 0) / mealCosts.length : 0;

  const byType = new Map(); // type -> {sum,count}
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
  // include any non-standard types after the known ones
  for (const [t, v] of byType) {
    if (!MEAL_ORDER.includes(t)) avgByMealType.push({ type: t, avg: v.sum / v.count });
  }

  const mealsPerTrip = totalTrips ? totalMeals / totalTrips : 0;

  // cost per meal: home-cooked vs. eating out
  const outsideAvgPerEvent = hasOutsideFood ? outsideFoodTotal / outsideFood.length : 0;
  const canCompareMealCost = avgCostPerMeal > 0 && hasOutsideFood;
  const eatingOutMultiplier = canCompareMealCost ? outsideAvgPerEvent / avgCostPerMeal : null;

  // item breakdown: cost + how many meals it showed up in, combined
  const mealsByItem = new Map(); // item -> Set(meal_id)
  mealUsage.forEach((r, i) => {
    const item = (r.item || "").trim();
    if (!item) return;
    const mealKey = (r.meal_id || "").trim() || `row${i}`;
    if (!mealsByItem.has(item)) mealsByItem.set(item, new Set());
    mealsByItem.get(item).add(mealKey);
  });
  const itemBreakdown = [...costByItem.entries()]
    .map(([item, total]) => {
      const count = mealsByItem.get(item)?.size || 0;
      return { item, total, count, avgPerUse: count ? total / count : null };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  // --- waste ---
  const totalWaste = waste.reduce((s, r) => {
    const v = num(r.waste_value);
    return s + (Number.isFinite(v) ? v : n0(r.qty_wasted) * n0(r.unit_cost));
  }, 0);
  const wastePct = totalSpent > 0 ? (totalWaste / totalSpent) * 100 : 0;
  const hasWaste = waste.length > 0;

  // --- inventory: active batches only, lowest fraction-remaining first ---
  const activeInventoryAll = inventory
    .filter((r) => ["OPEN", "FUZZY"].includes(String(r.status || "").trim().toUpperCase()))
    .map((r) => {
      const purchased = num(r.qty_purchased);
      const remaining = num(r.qty_remaining);
      const pct = Number.isFinite(purchased) && purchased > 0 && Number.isFinite(remaining)
        ? (remaining / purchased) * 100 : null;
      // Fuzzy estimates can drift at/below 0 — that's just an overshot portion
      // estimate, not a real negative quantity, so clamp what we display.
      const pctClamped = pct == null ? null : Math.max(0, pct);
      return { ...r, pctRemaining: pctClamped };
    })
    .sort((a, b) => {
      const pa = a.pctRemaining == null ? 101 : a.pctRemaining;
      const pb = b.pctRemaining == null ? 101 : b.pctRemaining;
      return pa - pb;
    });
  const INVENTORY_LIMIT = 12;
  const activeInventory = activeInventoryAll.slice(0, INVENTORY_LIMIT);
  const activeInventoryMoreCount = Math.max(0, activeInventoryAll.length - INVENTORY_LIMIT);

  // --- days tracked ---
  const allDates = new Set([
    ...purchases.map((r) => (r.date || "").trim()),
    ...meals.map((r) => (r.date || "").trim()),
    ...outsideFood.map((r) => (r.date || "").trim()),
    ...waste.map((r) => (r.date || "").trim()),
  ].filter(Boolean));
  const sortedDates = [...allDates].sort();
  const dateRangeLabel = sortedDates.length
    ? (sortedDates[0] === sortedDates[sortedDates.length - 1]
        ? fmtDateShort(sortedDates[0])
        : `${fmtDateShort(sortedDates[0])} – ${fmtDateShort(sortedDates[sortedDates.length - 1])}`)
    : "";

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
      date: (first.date || "").trim(),
      icon: "🛒",
      type: "grocery",
      title: `${first.store || "Grocery"} trip — ${rows.length} item${rows.length === 1 ? "" : "s"}`,
      amount: total,
      sortKey: trip,
    });
  }
  for (const r of meals) {
    const c = num(r.est_cost);
    activity.push({
      date: (r.date || "").trim(),
      icon: "🍽️",
      type: "meal",
      title: `${cap((r.meal_type || "").trim().toLowerCase())} — ${r.description || ""}`,
      amount: Number.isFinite(c) ? c : null,
      sortKey: r.meal_id || "",
    });
  }
  for (const r of outsideFood) {
    activity.push({
      date: (r.date || "").trim(),
      icon: "🍴",
      type: "outside",
      title: r.description || "Outside food",
      amount: n0(r.cost),
      sortKey: `${r.date}-${r.description}`,
    });
  }
  for (const r of waste) {
    const v = num(r.waste_value);
    activity.push({
      date: (r.date || "").trim(),
      icon: "🗑️",
      type: "waste",
      title: `Wasted ${r.item || "item"}`,
      amount: -(Number.isFinite(v) ? v : n0(r.qty_wasted) * n0(r.unit_cost)),
      sortKey: r.batch_id || "",
    });
  }
  activity.sort((a, b) => {
    const d = String(b.date).localeCompare(String(a.date));
    if (d !== 0) return d;
    return String(b.sortKey).localeCompare(String(a.sortKey));
  });

  return {
    totalSpent, totalTrips, avgSpendPerTrip, dailySpend, cumulativeSpend, topItemsByCost,
    spendByCategory,
    totalMeals, avgCostPerMeal, avgByMealType, mealsPerTrip, itemBreakdown,
    totalWaste, wastePct, hasWaste,
    outsideFoodTotal, hasOutsideFood, foodTotal, outsideFoodPct,
    outsideAvgPerEvent, canCompareMealCost, eatingOutMultiplier,
    activeInventory, activeInventoryMoreCount, dateRangeLabel, activity: activity.slice(0, 25),
    hasPurchases: purchases.length > 0,
    hasMeals: meals.length > 0,
  };
}

/* ---- KPI rendering ------------------------------------------------- */

function renderKpis(s) {
  const set = (id, txt) => { document.getElementById(id).textContent = txt; };

  set("kpi-grocery-spend", s.hasPurchases ? fmtMoney0(s.totalSpent) : "—");
  set("kpi-grocery-spend-sub", s.hasPurchases ? `${fmtMoney(s.avgSpendPerTrip)} avg / trip` : "");

  set("kpi-outside-food", s.hasOutsideFood ? fmtMoney0(s.outsideFoodTotal) : "—");
  set("kpi-outside-food-sub", s.hasOutsideFood ? `${fmtPct(s.outsideFoodPct)} of food $` : "");

  set("kpi-avg-meal", s.totalMeals && s.avgCostPerMeal ? fmtMoney(s.avgCostPerMeal) : "—");

  set("kpi-waste-pct", s.hasPurchases ? fmtPct(s.wastePct) : "—");
  set("kpi-waste-sub", s.hasWaste
    ? `${fmtMoney(s.totalWaste)} wasted`
    : (s.hasPurchases ? "no waste logged 🎉" : ""));

  set("kpi-trips", s.totalTrips ? String(s.totalTrips) : "—");
  set("kpi-trips-sub", s.totalTrips && s.totalMeals
    ? `${s.mealsPerTrip.toFixed(1)} meals / trip` : "");

  set("kpi-meals", s.totalMeals ? String(s.totalMeals) : "—");
  set("kpi-meals-sub", s.dateRangeLabel || "");
}

/* ---- cost-per-meal comparison callout ------------------------------ */

function renderCompareCard(s) {
  const set = (id, txt) => { document.getElementById(id).textContent = txt; };
  set("compare-home", s.totalMeals ? fmtMoney(s.avgCostPerMeal) : "—");
  set("compare-home-sub", s.totalMeals ? `avg across ${s.totalMeals} meal${s.totalMeals === 1 ? "" : "s"}` : "");
  set("compare-outside", s.hasOutsideFood ? fmtMoney(s.outsideAvgPerEvent) : "—");
  set("compare-outside-sub", s.hasOutsideFood ? "avg per event" : "");

  const delta = document.getElementById("compare-delta");
  if (s.canCompareMealCost) {
    const mult = s.eatingOutMultiplier;
    delta.innerHTML = mult >= 1
      ? `Eating out costs <strong>${mult.toFixed(1)}×</strong> more per meal than cooking at home.`
      : `Eating out actually costs <strong>${(1 / mult).toFixed(1)}× less</strong> per meal than cooking at home right now.`;
  } else {
    delta.textContent = "Log a home-cooked meal and an outside food event to see the comparison.";
  }
}

/* ---- charts -------------------------------------------------------- */

const charts = {}; // keep refs so we can destroy before re-render (theme swap)

// draw a value label at each bar tip / cap; measures so text never clips
const valueLabelPlugin = {
  id: "valueLabels",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.formatter) return;
    const { ctx, chartArea } = chart;
    const horizontal = chart.options.indexAxis === "y";
    ctx.save();
    ctx.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    const ink = token("--text-primary");

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

function baseScales({ x = {}, y = {} } = {}) {
  const grid = token("--gridline");
  const baseline = token("--baseline");
  const muted = token("--text-muted");
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
    backgroundColor: token("--text-primary"),
    titleColor: token("--surface-1"),
    bodyColor: token("--surface-1"),
    padding: 10, cornerRadius: 8, displayColors: false,
  };
}

function legendStyle() {
  return {
    display: true,
    position: "bottom",
    labels: {
      color: token("--text-secondary"),
      boxWidth: 10, boxHeight: 10, padding: 14,
      font: { size: 12 },
    },
  };
}

function toggleChart(canvasId, emptyId, hasData) {
  const canvas = document.getElementById(canvasId);
  const empty = document.getElementById(emptyId);
  canvas.style.display = hasData ? "" : "none";
  empty.hidden = hasData;
  return hasData;
}

function renderDailySpendChart(s) {
  if (!toggleChart("chart-dailyspend", "empty-dailyspend", s.dailySpend.length > 0)) return;
  const c1 = token("--series-1");
  const c2 = token("--series-2");
  charts.dailyspend = new Chart(document.getElementById("chart-dailyspend"), {
    type: "bar",
    data: {
      labels: s.dailySpend.map((d) => fmtDateShort(d.date)),
      datasets: [
        {
          label: "Groceries",
          data: s.dailySpend.map((d) => d.groceries),
          backgroundColor: c1,
          borderRadius: 4, maxBarThickness: 40, stack: "spend",
        },
        {
          label: "Outside food",
          data: s.dailySpend.map((d) => d.outside),
          backgroundColor: c2,
          borderRadius: 4, maxBarThickness: 40, stack: "spend",
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: legendStyle(),
        tooltip: {
          ...tooltipStyle(),
          callbacks: { label: (i) => `${i.dataset.label}: ${fmtMoney(i.parsed.y)}` },
        },
      },
      scales: baseScales({
        x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmtMoney0(v) } },
      }),
    },
  });
}

function renderMealTypeChart(s) {
  if (!toggleChart("chart-mealtype", "empty-mealtype", s.avgByMealType.length > 0)) return;
  const c1 = token("--series-1");
  charts.mealtype = new Chart(document.getElementById("chart-mealtype"), {
    type: "bar",
    data: {
      labels: s.avgByMealType.map((d) => cap(d.type)),
      datasets: [{
        data: s.avgByMealType.map((d) => d.avg),
        backgroundColor: c1, // nominal categories → one hue for all bars
        borderRadius: 4, borderSkipped: "bottom",
        maxBarThickness: 48,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 22 } },
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipStyle(), callbacks: { label: (i) => fmtMoney(i.parsed.y) } },
        valueLabels: { formatter: fmtMoney },
      },
      scales: baseScales({
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: (v) => fmtMoney0(v) } },
      }),
    },
    plugins: [valueLabelPlugin],
  });
}

function renderTopItemsChart(s) {
  if (!toggleChart("chart-topitems", "empty-topitems", s.topItemsByCost.length > 0)) return;
  const c1 = token("--series-1");
  charts.topitems = new Chart(document.getElementById("chart-topitems"), {
    type: "bar",
    data: {
      labels: s.topItemsByCost.map((d) => d.item),
      datasets: [{
        data: s.topItemsByCost.map((d) => d.total),
        backgroundColor: c1,
        borderRadius: 4, borderSkipped: "start",
        maxBarThickness: 24,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 56 } },
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipStyle(), callbacks: { label: (i) => fmtMoney(i.parsed.x) } },
        valueLabels: { formatter: fmtMoney },
      },
      scales: baseScales({
        x: { beginAtZero: true, ticks: { callback: (v) => fmtMoney0(v) } },
        y: { grid: { display: false } },
      }),
    },
    plugins: [valueLabelPlugin],
  });
}

function renderSplitFoodChart(s) {
  // groceries vs. outside food, side by side on one value axis
  if (!toggleChart("chart-splitfood", "empty-splitfood", s.hasPurchases || s.hasOutsideFood)) return;
  const c1 = token("--series-1");
  const c2 = token("--series-2");
  charts.splitfood = new Chart(document.getElementById("chart-splitfood"), {
    type: "bar",
    data: {
      labels: ["Groceries", "Outside food"],
      datasets: [{
        data: [s.totalSpent, s.outsideFoodTotal],
        backgroundColor: [c1, c2],
        borderRadius: 4, borderSkipped: "start",
        maxBarThickness: 24,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 64 } },
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipStyle(), callbacks: { label: (i) => fmtMoney(i.parsed.x) } },
        valueLabels: { formatter: fmtMoney0 },
      },
      scales: baseScales({
        x: { beginAtZero: true, ticks: { callback: (v) => fmtMoney0(v) } },
        y: { grid: { display: false } },
      }),
    },
    plugins: [valueLabelPlugin],
  });
}

// draw a value label at the last point of a single-series line — "value at the end"
const endLabelPlugin = {
  id: "endLabel",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.formatter) return;
    const data = chart.data.datasets[0].data;
    if (!data.length) return;
    const meta = chart.getDatasetMeta(0);
    const lastPoint = meta.data[meta.data.length - 1];
    const label = opts.formatter(data[data.length - 1]);
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = token("--text-primary");
    const w = ctx.measureText(label).width;
    const outside = lastPoint.x + 8 + w <= chartArea.right;
    ctx.textAlign = outside ? "left" : "right";
    ctx.fillText(label, outside ? lastPoint.x + 8 : lastPoint.x - 8, lastPoint.y);
    ctx.restore();
  },
};

function renderCumulativeChart(s) {
  if (!toggleChart("chart-cumulative", "empty-cumulative", s.cumulativeSpend.length > 0)) return;
  const c1 = token("--series-1");
  const surface = token("--surface-1");
  charts.cumulative = new Chart(document.getElementById("chart-cumulative"), {
    type: "line",
    data: {
      labels: s.cumulativeSpend.map((d) => fmtDateShort(d.date)),
      datasets: [{
        data: s.cumulativeSpend.map((d) => d.total),
        borderColor: c1,
        backgroundColor: c1 + "1a", // ~10% opacity wash, per mark spec
        fill: true,
        borderWidth: 2, tension: 0,
        pointRadius: (ctx) => (ctx.dataIndex === ctx.dataset.data.length - 1 ? 5 : 0),
        pointHoverRadius: 6,
        pointBackgroundColor: c1,
        pointBorderColor: surface, pointBorderWidth: 2,
        pointHitRadius: 24,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      layout: { padding: { right: 56, top: 8 } },
      plugins: {
        legend: { display: false }, // single series — the title names it
        tooltip: { ...tooltipStyle(), callbacks: { label: (i) => fmtMoney(i.parsed.y) } },
        endLabel: { formatter: fmtMoney },
      },
      scales: baseScales({
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: { beginAtZero: true, ticks: { callback: (v) => fmtMoney0(v) } },
      }),
    },
    plugins: [endLabelPlugin],
  });
}

function renderCategoryChart(s) {
  if (!toggleChart("chart-category", "empty-category", s.spendByCategory.length > 0)) return;
  const surface = token("--surface-1");
  const datasets = s.spendByCategory.map((c) => ({
    label: c.category,
    data: [c.total],
    backgroundColor: token(CATEGORY_COLOR_SLOTS[c.category] || "--series-6"),
    borderColor: surface, borderWidth: 2, // surface-color border = the "gap" between segments
    borderRadius: 4,
    maxBarThickness: 24,
    stack: "category",
    _pct: c.pct, _total: c.total,
  }));
  charts.category = new Chart(document.getElementById("chart-category"), {
    type: "bar",
    data: { labels: [""], datasets },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true, position: "bottom",
          labels: {
            color: token("--text-secondary"),
            boxWidth: 10, boxHeight: 10, padding: 12,
            font: { size: 12 },
            // direct labels via the legend text (category + $ + %) — the
            // secondary encoding the CVD/contrast WARN on this palette requires
            generateLabels: (chart) => chart.data.datasets.map((ds, i) => ({
              text: `${ds.label} — ${fmtMoney0(ds._total)} (${ds._pct.toFixed(0)}%)`,
              fillStyle: ds.backgroundColor,
              strokeStyle: ds.backgroundColor,
              lineWidth: 0,
              datasetIndex: i,
            })),
          },
        },
        tooltip: {
          ...tooltipStyle(),
          callbacks: { label: (i) => `${i.dataset.label}: ${fmtMoney(i.dataset._total)} (${i.dataset._pct.toFixed(0)}%)` },
        },
      },
      scales: baseScales({
        x: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmtMoney0(v) } },
        y: { stacked: true, display: false, grid: { display: false } },
      }),
    },
  });
}

/* ---- tables -------------------------------------------------------- */

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
  const cls = s.toLowerCase();
  return s ? `<span class="pill pill--${esc(cls)}">${esc(s)}</span>` : "";
}

function levelBar(pct) {
  if (pct == null) return "";
  const clamped = Math.max(0, Math.min(100, pct));
  const low = clamped <= 20 ? " bar-fill--low" : "";
  return `<div class="bar-track"><div class="bar-fill${low}" style="width:${clamped}%"></div></div>`;
}

function renderTables(data, stats) {
  // item breakdown — cost + how often it's used, combined
  buildTable("table-itembreakdown",
    [
      { key: "item", label: "Item" },
      { label: "Total cost", num: true, render: (r) => fmtMoney(r.total) },
      { label: "Times used", num: true, render: (r) => String(r.count) },
      { label: "Avg / use", num: true,
        render: (r) => r.avgPerUse != null ? fmtMoney(r.avgPerUse) : "—" },
    ],
    stats.itemBreakdown,
    "Log a receipt and a meal to see item cost breakdown here.");

  // inventory — active batches only, lowest remaining first
  buildTable("table-inventory",
    [
      { key: "item", label: "Item" },
      { label: "Level", render: (r) => levelBar(r.pctRemaining) },
      { label: "Remaining", num: true,
        render: (r) => {
          const q = num(r.qty_remaining);
          const qTxt = Number.isFinite(q) && q < 0 ? "~0" : esc(r.qty_remaining ?? "");
          return `${qTxt} ${esc(r.unit ?? "")}`.trim();
        } },
      { label: "Status", render: (r) => statusPill(r.status) },
    ],
    stats.activeInventory,
    "No open inventory — log your first receipt.");
  if (stats.activeInventory.length && stats.activeInventoryMoreCount > 0) {
    document.getElementById("table-inventory").insertAdjacentHTML("beforeend",
      `<p class="table-more">+${stats.activeInventoryMoreCount} more open batch${stats.activeInventoryMoreCount === 1 ? "" : "es"} — see <code>inventory.csv</code></p>`);
  }

  // unified activity feed
  const el = document.getElementById("table-activity");
  if (!stats.activity.length) {
    el.innerHTML = `<p class="empty">Log a receipt, meal, or outside food event to see activity here.</p>`;
    return;
  }
  el.innerHTML = `<div class="activity-list">${stats.activity.map((a) => {
    const amountCls = a.amount != null && a.amount < 0 ? " activity-amount--neg" : "";
    const amountTxt = a.amount == null ? "—" : (a.amount < 0 ? "-" : "") + fmtMoney(Math.abs(a.amount));
    return `<div class="activity-item">
      <span class="activity-icon" aria-hidden="true">${a.icon}</span>
      <div class="activity-main">
        <span class="activity-title">${esc(a.title)}</span>
        <span class="activity-date">${esc(fmtDateShort(a.date))}</span>
      </div>
      <span class="activity-amount${amountCls}">${amountTxt}</span>
    </div>`;
  }).join("")}</div>`;
}

/* ---- last updated -------------------------------------------------- */

function renderLastUpdated(loaded) {
  const stamps = Object.values(loaded)
    .map((d) => d.lastModified)
    .filter(Boolean)
    .map((s) => new Date(s))
    .filter((d) => !isNaN(d));
  if (!stamps.length) return;
  const latest = new Date(Math.max(...stamps.map((d) => d.getTime())));
  const el = document.getElementById("last-updated");
  el.textContent = "Updated " + latest.toLocaleDateString(undefined,
    { year: "numeric", month: "short", day: "numeric" });
  el.hidden = false;
}

/* ---- orchestration ------------------------------------------------- */

let CACHE = null; // parsed rows, so we can re-render on theme change

function renderAll() {
  if (!CACHE) return;
  const stats = computeStats(CACHE);
  renderKpis(stats);
  renderCompareCard(stats);
  Object.values(charts).forEach((c) => c && c.destroy());
  renderDailySpendChart(stats);
  renderCumulativeChart(stats);
  renderMealTypeChart(stats);
  renderCategoryChart(stats);
  renderSplitFoodChart(stats);
  renderTopItemsChart(stats);
  renderTables(CACHE, stats);
}

async function init() {
  const entries = await Promise.all(
    Object.entries(CSV_FILES).map(async ([key, path]) => [key, await loadCsv(path)])
  );
  const loaded = Object.fromEntries(entries);
  CACHE = Object.fromEntries(entries.map(([k, v]) => [k, v.rows]));

  Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', sans-serif";
  Chart.defaults.color = token("--text-secondary");

  renderLastUpdated(loaded);
  renderAll();

  // re-render charts when the OS theme flips so tokens stay in sync
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => { Chart.defaults.color = token("--text-secondary"); renderAll(); };
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

document.addEventListener("DOMContentLoaded", init);
