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
};

const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"];

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
  const { purchases, meals, mealUsage, waste } = data;

  // --- purchases / trips ---
  const totalSpent = purchases.reduce((s, r) => s + n0(r.total_price), 0);

  const tripIds = new Set(purchases.map((r) => (r.trip_id || "").trim()).filter(Boolean));
  const tripDates = new Set(purchases.map((r) => (r.date || "").trim()).filter(Boolean));
  const totalTrips = tripIds.size || tripDates.size;
  const avgSpendPerTrip = totalTrips ? totalSpent / totalTrips : 0;

  // spend over time (by date)
  const byDate = new Map();
  for (const r of purchases) {
    const d = (r.date || "").trim();
    if (!d) continue;
    byDate.set(d, (byDate.get(d) || 0) + n0(r.total_price));
  }
  const spendSeries = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, total]) => ({ date, total }));

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
    .slice(0, 5);

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

  // top items by frequency (distinct meals per item)
  const mealsByItem = new Map(); // item -> Set(meal_id)
  mealUsage.forEach((r, i) => {
    const item = (r.item || "").trim();
    if (!item) return;
    const mealKey = (r.meal_id || "").trim() || `row${i}`;
    if (!mealsByItem.has(item)) mealsByItem.set(item, new Set());
    mealsByItem.get(item).add(mealKey);
  });
  const topItemsByFreq = [...mealsByItem.entries()]
    .map(([item, set]) => ({ item, count: set.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // --- waste ---
  const totalWaste = waste.reduce((s, r) => {
    const v = num(r.waste_value);
    return s + (Number.isFinite(v) ? v : n0(r.qty_wasted) * n0(r.unit_cost));
  }, 0);
  const wastePct = totalSpent > 0 ? (totalWaste / totalSpent) * 100 : 0;

  return {
    totalSpent, totalTrips, avgSpendPerTrip, spendSeries, topItemsByCost,
    totalMeals, avgCostPerMeal, avgByMealType, mealsPerTrip, topItemsByFreq,
    totalWaste, wastePct,
    hasPurchases: purchases.length > 0,
    hasMeals: meals.length > 0,
    hasWaste: waste.length > 0,
  };
}

/* ---- KPI rendering ------------------------------------------------- */

function renderKpis(s) {
  const set = (id, txt) => { document.getElementById(id).textContent = txt; };

  set("kpi-total-spent", s.hasPurchases ? fmtMoney0(s.totalSpent) : "—");
  set("kpi-total-spent-sub", s.hasPurchases ? `${fmtMoney(s.avgSpendPerTrip)} avg / trip` : "");

  set("kpi-avg-meal", s.totalMeals && s.avgCostPerMeal ? fmtMoney(s.avgCostPerMeal) : "—");

  set("kpi-waste-pct", s.hasPurchases ? fmtPct(s.wastePct) : "—");
  set("kpi-waste-sub", s.hasWaste ? `${fmtMoney(s.totalWaste)} wasted` : "");

  set("kpi-trips", s.totalTrips ? String(s.totalTrips) : "—");
  set("kpi-trips-sub", s.totalTrips && s.totalMeals
    ? `${s.mealsPerTrip.toFixed(1)} meals / trip` : "");

  set("kpi-meals", s.totalMeals ? String(s.totalMeals) : "—");
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

function toggleChart(canvasId, emptyId, hasData) {
  const canvas = document.getElementById(canvasId);
  const empty = document.getElementById(emptyId);
  canvas.style.display = hasData ? "" : "none";
  empty.hidden = hasData;
  return hasData;
}

function renderSpendChart(s) {
  if (!toggleChart("chart-spend", "empty-spend", s.spendSeries.length > 0)) return;
  const c1 = token("--series-1");
  const surface = token("--surface-1");
  charts.spend = new Chart(document.getElementById("chart-spend"), {
    type: "line",
    data: {
      labels: s.spendSeries.map((d) => d.date),
      datasets: [{
        data: s.spendSeries.map((d) => d.total),
        borderColor: c1, backgroundColor: c1,
        borderWidth: 2, tension: 0,
        pointRadius: s.spendSeries.length === 1 ? 5 : 3,
        pointHoverRadius: 6,
        pointBackgroundColor: c1,
        pointBorderColor: surface, pointBorderWidth: 2, // 2px surface ring
        pointHitRadius: 24,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false }, // single series
        tooltip: {
          ...tooltipStyle(),
          callbacks: { label: (i) => fmtMoney(i.parsed.y) },
        },
      },
      scales: baseScales({
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => fmtMoney0(v) },
        },
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

function renderWasteChart(s) {
  // waste is part of spend: show wasted vs. total spend on one value axis
  if (!toggleChart("chart-waste", "empty-waste", s.hasPurchases)) return;
  const c1 = token("--series-1");
  const crit = token("--status-critical");
  charts.waste = new Chart(document.getElementById("chart-waste"), {
    type: "bar",
    data: {
      labels: ["Total spend", "Wasted"],
      datasets: [{
        data: [s.totalSpent, s.totalWaste],
        backgroundColor: [c1, crit],
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

function renderTables(data, stats) {
  // top items by frequency
  buildTable("table-topfreq",
    [
      { key: "item", label: "Item" },
      { key: "count", label: "Meals", num: true },
    ],
    stats.topItemsByFreq,
    "No meal items logged yet.");

  // inventory — OPEN batches first
  const inv = [...data.inventory].sort((a, b) => {
    const rank = (r) => (String(r.status).toUpperCase() === "OPEN" ? 0 : 1);
    return rank(a) - rank(b);
  });
  buildTable("table-inventory",
    [
      { key: "item", label: "Item" },
      { label: "Remaining", num: true,
        render: (r) => `${esc(r.qty_remaining ?? "")} ${esc(r.unit ?? "")}`.trim() },
      { label: "Status", render: (r) => statusPill(r.status) },
    ],
    inv,
    "No inventory yet — log your first receipt.");

  // recent purchases (newest first, cap at 25)
  const purchases = [...data.purchases]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 25);
  buildTable("table-purchases",
    [
      { key: "date", label: "Date" },
      { key: "item", label: "Item" },
      { key: "store", label: "Store" },
      { label: "Qty", num: true, render: (r) => `${esc(r.qty ?? "")} ${esc(r.unit ?? "")}`.trim() },
      { label: "Total", num: true, render: (r) => fmtMoney(n0(r.total_price)) },
    ],
    purchases,
    "Log your first receipt to see purchases here.");

  // recent meals
  const meals = [...data.meals]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 25);
  buildTable("table-meals",
    [
      { key: "date", label: "Date" },
      { label: "Meal", render: (r) => esc(cap((r.meal_type || "").toLowerCase())) },
      { key: "description", label: "Description" },
      { label: "Est. cost", num: true,
        render: (r) => Number.isFinite(num(r.est_cost)) ? fmtMoney(num(r.est_cost)) : "—" },
    ],
    meals,
    "Log your first meal to see it here.");

  // waste log
  const waste = [...data.waste]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 25);
  buildTable("table-waste",
    [
      { key: "date", label: "Date" },
      { key: "item", label: "Item" },
      { label: "Qty", num: true, render: (r) => `${esc(r.qty_wasted ?? "")} ${esc(r.unit ?? "")}`.trim() },
      { label: "Value", num: true, render: (r) => {
          const v = num(r.waste_value);
          return fmtMoney(Number.isFinite(v) ? v : n0(r.qty_wasted) * n0(r.unit_cost));
      } },
      { key: "reason", label: "Reason" },
    ],
    waste,
    "No waste logged — nothing thrown out yet. 🎉");
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
  Object.values(charts).forEach((c) => c && c.destroy());
  renderSpendChart(stats);
  renderMealTypeChart(stats);
  renderTopItemsChart(stats);
  renderWasteChart(stats);
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
