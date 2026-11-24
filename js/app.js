"use strict";

/* ==========================================================================
   Utilidades
   ========================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const OPTIONS = {
  especies: ["Gato", "Perro", "Perro y gato"],
  etapas: ["Adulto", "Gatito", "Cachorro", "Todas las edades", "Senior", "Esterilizado"],
  clasificaciones: ["Alimento completo", "Dieta especial", "Alimento complementario", "Snack"],
  texturas: ["Paté", "Trozos en salsa", "Desmenuzado", "Loaf en salsa", "Húmedo", "Caldo", "Guiso"],
  formatos: ["Lata", "Pote", "Sobre"],
  canales: ["Tienda de mascotas", "Supermercado", "Veterinaria", "Tienda online"],
  pesos: [70, 80, 85, 156, 200, 290, 400, 800]
};
const SHORT_CLASIF = {
  "Alimento completo": "Completo",
  "Dieta especial": "Dieta especial",
  "Alimento complementario": "Complementario",
  "Snack": "Snack"
};
const SPECIES_CLASS = { "Gato": "s-gato", "Perro": "s-perro", "Perro y gato": "s-ambos" };
const PAGE_SIZE = 50;

function escapeHTML(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function fold(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function fmtCLP(v) { return "$" + Math.round(v).toLocaleString("es-CL"); }
function fmtShort(v) {
  return v >= 1000 ? "$" + (v / 1000).toLocaleString("es-CL", { maximumFractionDigits: 1 }) + "k" : fmtCLP(v);
}
function fmtPct(v) { return Math.round(Math.abs(v)).toLocaleString("es-CL") + "%"; }
function fmtGrams(g) { return Number(g).toLocaleString("es-CL", { maximumFractionDigits: 1 }) + " g"; }
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseISODate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function fmtDate(iso) {
  const d = parseISODate(iso);
  if (!d) return "Estudio inicial";
  return d.toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(isoTs) {
  const d = new Date(isoTs);
  return d.toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
}
function daysSince(isoTs) {
  return Math.floor((Date.now() - new Date(isoTs).getTime()) / 86400000);
}
function relativeDays(isoTs) {
  const d = daysSince(isoTs);
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  return `hace ${d} días`;
}

/* Lee números escritos a la chilena: "1.290", "$5.490", "1.290,5", "85g". */
function parseNumberCL(v) {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!s) return NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  return parseFloat(s);
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}
function calcStats(arr) {
  if (!arr.length) return { n: 0, mean: 0, sd: 0, p25: 0, median: 0, p75: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, v) => a + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(s.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, sd, p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75) };
}
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

function productKey(r) {
  return [fold(r.marca).trim(), fold(r.producto).trim(), Number(r.peso_gr), fold(r.especie)].join("|");
}
function compareDateDesc(a, b) {
  const fa = a.fecha || "", fb = b.fecha || "";
  if (fa !== fb) return fa < fb ? 1 : -1;
  return (a.creado || "") < (b.creado || "") ? 1 : -1;
}

/* Precio vigente: el más reciente de cada producto en cada comercio. */
function latestPrices(records) {
  const map = new Map();
  records.forEach(r => {
    const k = productKey(r) + "|" + fold(r.comercio);
    const cur = map.get(k);
    if (!cur || compareDateDesc(r, cur) < 0) map.set(k, r);
  });
  return Array.from(map.values());
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ==========================================================================
   Estado
   ========================================================================== */
let DB = { records: [], stores: [], meta: {} };
const ui = {
  route: "inicio",
  home: { especie: "ALL", comercio: "ALL", detail: false, showAllDeals: false },
  list: { q: "", especie: "ALL", comercio: "ALL", sort: "recent", page: 0 },
  add: { product: null, isNew: false, especie: "Gato", comercio: null },
  importData: null
};

function refreshFromStore() {
  const snap = { records: DataStore.state.records, stores: DataStore.state.stores, meta: DataStore.state.meta };
  DB = snap;
}

/* ==========================================================================
   Avisos (toasts) y hojas (diálogos)
   ========================================================================== */
function showToast({ title, message = "", tone = "ok", action = null, duration = 7000 }) {
  const wrap = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast glass toast-${tone}`;
  el.setAttribute("role", tone === "error" ? "alert" : "status");
  const icon = tone === "ok" ? "i-check" : tone === "error" ? "i-warn" : "i-info";
  el.innerHTML = `
    <svg class="icon toast-icon"><use href="#${icon}"/></svg>
    <div class="toast-text"><div class="toast-title">${escapeHTML(title)}</div>${message ? `<div class="toast-msg">${escapeHTML(message)}</div>` : ""}</div>
    ${action ? `<button type="button" class="toast-action">${escapeHTML(action.label)}</button>` : ""}
    <button type="button" class="icon-btn toast-close" aria-label="Cerrar aviso"><svg class="icon"><use href="#i-close"/></svg></button>`;
  wrap.appendChild(el);

  let timer = null;
  const close = () => { el.classList.add("leaving"); setTimeout(() => el.remove(), 200); };
  const arm = () => { if (tone !== "error") timer = setTimeout(close, duration); };
  el.addEventListener("pointerenter", () => clearTimeout(timer));
  el.addEventListener("focusin", () => clearTimeout(timer));
  el.addEventListener("pointerleave", arm);
  $(".toast-close", el).addEventListener("click", close);
  if (action) {
    $(".toast-action", el).addEventListener("click", async () => { close(); await action.fn(); });
  }
  arm();
  while (wrap.children.length > 3) wrap.firstElementChild.remove();
}

const sheet = {
  el: null,
  onClose: null,
  open({ title, body, foot, onMount, onClose }) {
    this.el = $("#sheet");
    $("#sheet-title").textContent = title;
    $("#sheet-body").innerHTML = body;
    $("#sheet-foot").innerHTML = foot;
    this.onClose = onClose || null;
    if (!this.el.open) this.el.showModal();
    if (onMount) onMount(this.el);
  },
  close() {
    if (this.el && this.el.open) this.el.close();
  }
};

function confirmSheet({ title, message, confirmLabel, destructive = false, extraButton = null }) {
  return new Promise(resolve => {
    let decided = false;
    sheet.open({
      title,
      body: `<p class="sheet-msg">${escapeHTML(message)}</p>`,
      foot: `
        ${extraButton ? `<button type="button" class="btn btn-secondary" data-act="extra">${escapeHTML(extraButton.label)}</button>` : ""}
        <span class="spacer"></span>
        <button type="button" class="btn btn-secondary" data-act="cancel">Cancelar</button>
        <button type="button" class="btn ${destructive ? "btn-destructive-fill" : "btn-primary"}" data-act="ok">${escapeHTML(confirmLabel)}</button>`,
      onMount(el) {
        $('[data-act="cancel"]', el).addEventListener("click", () => { decided = true; sheet.close(); resolve(false); });
        $('[data-act="ok"]', el).addEventListener("click", () => { decided = true; sheet.close(); resolve(true); });
        if (extraButton) $('[data-act="extra"]', el).addEventListener("click", () => extraButton.fn());
        $('[data-act="cancel"]', el).focus();
      },
      onClose() { if (!decided) resolve(false); }
    });
  });
}

/* ==========================================================================
   Navegación
   ========================================================================== */
const ROUTES = ["inicio", "agregar", "productos", "importar", "respaldo"];

function handleRoute() {
  let r = (location.hash || "#inicio").slice(1);
  if (!ROUTES.includes(r)) r = "inicio";
  ui.route = r;
  $$(".view").forEach(v => { v.hidden = v.dataset.view !== r; });
  $$("[data-route]").forEach(a => {
    if (a.dataset.route === r) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  Charts.hideTip();
  renderRoute();
  window.scrollTo(0, 0);
}

function renderRoute() {
  if (ui.route === "inicio") renderHome();
  else if (ui.route === "agregar") renderAdd();
  else if (ui.route === "productos") renderList();
  else if (ui.route === "respaldo") renderBackup();
  renderStatus();
}

function afterDataChange() {
  refreshFromStore();
  renderStatus();
  fillDatalists();
}

/* Estado de guardado en la barra lateral */
function renderStatus() {
  const el = $("#save-status");
  const meta = DB.meta || {};
  let backupLine;
  if (!meta.lastBackupAt) {
    backupLine = `<a href="#respaldo" class="status-warn"><svg class="icon"><use href="#i-warn"/></svg>Aún no hay copia de seguridad</a>`;
  } else if (meta.lastChangeAt && meta.lastChangeAt > meta.lastBackupAt && daysSince(meta.lastBackupAt) >= APP_CONFIG.backupReminderDays) {
    backupLine = `<a href="#respaldo" class="status-warn"><svg class="icon"><use href="#i-warn"/></svg>Última copia ${relativeDays(meta.lastBackupAt)}</a>`;
  } else {
    backupLine = `<span class="status-muted">Última copia ${relativeDays(meta.lastBackupAt)}</span>`;
  }
  const where = DataStore.isCloud ? "Guardado en la nube" : "Guardado en este navegador";
  const saveLine = DataStore.saveError
    ? `<span class="status-error"><svg class="icon"><use href="#i-warn"/></svg>No se pudo guardar</span>`
    : `<span class="status-ok"><svg class="icon"><use href="#i-check"/></svg>${where}</span>`;
  const account = DataStore.isCloud && Cloud.user
    ? `<span class="status-muted status-account">${escapeHTML(Cloud.user.email)}</span><button type="button" class="link-btn status-signout" data-auth-signout>Cerrar sesión</button>`
    : "";
  el.innerHTML = `${saveLine}${backupLine}<span class="status-muted">${DB.records.length.toLocaleString("es-CL")} precios</span>${account}`;
  const so = el.querySelector("[data-auth-signout]");
  if (so) so.addEventListener("click", () => Auth.signOut());
}

/* ==========================================================================
   Controles comunes
   ========================================================================== */
function bindSegmented(el, onChange) {
  const buttons = $$('[role="radio"]', el);
  const select = btn => {
    buttons.forEach(b => {
      const on = b === btn;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    onChange(btn.dataset.value);
  };
  buttons.forEach((b, i) => {
    b.tabIndex = b.getAttribute("aria-checked") === "true" ? 0 : -1;
    b.addEventListener("click", () => select(b));
    b.addEventListener("keydown", e => {
      let j = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % buttons.length;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + buttons.length) % buttons.length;
      if (j !== null) { e.preventDefault(); buttons[j].focus(); select(buttons[j]); }
    });
  });
}
function setSegmented(el, value) {
  $$('[role="radio"]', el).forEach(b => {
    const on = b.dataset.value === value;
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
  });
}

function storeOptions(includeAll) {
  return (includeAll ? `<option value="ALL">Todos los comercios</option>` : "") +
    DB.stores.map(s => `<option value="${escapeHTML(s.nombre)}">${escapeHTML(s.nombre)}</option>`).join("");
}

/* Rellena un selector de comercios solo si la lista cambió; devuelve el valor vigente. */
function syncStoreSelect(sel, current) {
  const sig = DB.stores.map(s => s.nombre).join("|");
  if (sel.dataset.sig !== sig) {
    sel.innerHTML = storeOptions(true);
    sel.dataset.sig = sig;
  }
  sel.value = DB.stores.some(s => s.nombre === current) ? current : "ALL";
  return sel.value;
}

function fillSelect(el, values, current) {
  el.innerHTML = values.map(v => `<option${v === current ? " selected" : ""}>${escapeHTML(v)}</option>`).join("");
}

function fillDatalists() {
  const brands = [...new Set(DB.records.map(r => r.marca))].sort((a, b) => a.localeCompare(b, "es"));
  $("#dl-marcas").innerHTML = brands.map(b => `<option value="${escapeHTML(b)}"></option>`).join("");
  const prots = [...new Set(DB.records.map(r => r.proteina).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  $("#dl-proteinas").innerHTML = prots.map(b => `<option value="${escapeHTML(b)}"></option>`).join("");
}

function toggleTableButtons() {
  $$("[data-toggle-table]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.toggleTable;
      const chart = document.getElementById(id);
      const table = document.getElementById(id + "-table");
      const showTable = table.hidden;
      table.hidden = !showTable;
      chart.hidden = showTable;
      btn.textContent = showTable ? "Ver gráfico" : "Ver datos";
      if (!showTable) renderHome();
    });
  });
}

function simpleTable(headers, rows) {
  return `<div class="table-wrap"><table class="table"><thead><tr>${headers.map(h => `<th scope="col" class="${h.num ? "num" : ""}">${escapeHTML(h.label)}</th>`).join("")}</tr></thead><tbody>${
    rows.map(r => `<tr>${r.map((c, i) => `<td class="${headers[i].num ? "num" : ""}">${escapeHTML(c)}</td>`).join("")}</tr>`).join("")
  }</tbody></table></div>`;
}

/* ==========================================================================
   INICIO
   ========================================================================== */
function homeData() {
  const current = latestPrices(DB.records);
  const bySpecies = current.filter(r => ui.home.especie === "ALL" || r.especie === ui.home.especie);
  const filtered = bySpecies.filter(r => ui.home.comercio === "ALL" || r.comercio === ui.home.comercio);
  const byStore = current.filter(r => ui.home.comercio === "ALL" || r.comercio === ui.home.comercio);
  return { current, bySpecies, filtered, byStore };
}

function renderHome() {
  const { bySpecies, filtered, byStore } = homeData();
  ui.home.comercio = syncStoreSelect($("#home-store"), ui.home.comercio);

  // La línea bajo el título dice el hallazgo de los datos, no cómo usar la pantalla.
  const brands = new Set(filtered.map(r => fold(r.marca))).size;
  const stores = new Set(filtered.map(r => r.comercio)).size;
  const counts = `${filtered.length.toLocaleString("es-CL")} precios vigentes de ${brands} marcas en ${stores} comercio${stores === 1 ? "" : "s"}.`;
  const cat = calcStats(byStore.filter(r => r.especie === "Gato").map(r => r.precio_kg)).median;
  const dog = calcStats(byStore.filter(r => r.especie === "Perro").map(r => r.precio_kg)).median;
  let finding = "";
  if (cat > 0 && dog > 0) {
    const gap = (cat - dog) / dog * 100;
    finding = `<strong>La comida de gato cuesta ${fmtPct(gap)} ${gap >= 0 ? "más" : "menos"} por kilo que la de perro</strong> (${fmtCLP(cat)} contra ${fmtCLP(dog)}). `;
  }
  $("#home-caption").innerHTML = finding + escapeHTML(counts);

  renderKpis(filtered, bySpecies);
  renderTypeChart(filtered);
  renderStoreChart(bySpecies);
  renderDeals(bySpecies);
  if (ui.home.detail) renderDetail(filtered);
}

function kpiCell(label, valueHTML, unit, note, lead = false) {
  return `<div class="kpi${lead ? " kpi-lead" : ""}">
      <h2 class="kpi-label">${escapeHTML(label)}</h2>
      <p class="kpi-value">${valueHTML}${unit ? `<span class="kpi-unit">${escapeHTML(unit)}</span>` : ""}</p>
      <p class="kpi-note">${escapeHTML(note)}</p>
    </div>`;
}

function renderKpis(filtered, bySpecies) {
  const DASH = '<span class="muted">–</span>';
  const st = calcStats(filtered.map(r => r.precio_kg));
  const small = calcStats(filtered.filter(r => r.peso_gr < 150).map(r => r.precio_kg)).median;
  const large = calcStats(filtered.filter(r => r.peso_gr >= 400).map(r => r.precio_kg)).median;
  // Comercio con el precio típico más bajo; solo comercios con 5 precios o más, para no engañar.
  const storeStats = DB.stores
    .map(s => ({ name: s.nombre, ...calcStats(bySpecies.filter(r => r.comercio === s.nombre).map(r => r.precio_kg)) }))
    .filter(s => s.n >= 5)
    .sort((x, y) => x.median - y.median);
  const cheapest = storeStats[0];

  const cells = [];
  cells.push(st.n
    ? kpiCell("Precio típico", fmtCLP(st.median), "por kilo", `La mitad cuesta menos. La mayoría, entre ${fmtCLP(st.p25)} y ${fmtCLP(st.p75)}.`, true)
    : kpiCell("Precio típico", DASH, "", "No hay precios para este filtro.", true));
  cells.push(cheapest
    ? kpiCell("Comercio más económico", escapeHTML(cheapest.name), "", `Precio típico ${fmtCLP(cheapest.median)} por kilo, en ${cheapest.n} productos.`)
    : kpiCell("Comercio más económico", DASH, "", "Hacen falta 5 precios o más por comercio."));
  if (small > 0 && large > 0) {
    const diff = (small - large) / small * 100;
    cells.push(kpiCell("Envases grandes", `${diff >= 0 ? "−" : "+"}${fmtPct(diff)}`, "por kilo", "Envases de 400 g o más, comparados con los de menos de 150 g."));
  } else {
    cells.push(kpiCell("Envases grandes", DASH, "", "Faltan envases chicos o grandes para comparar."));
  }
  $("#kpis").innerHTML = cells.join("");
}

function typeSeries() {
  const e = ui.home.especie;
  const all = [
    { key: "Gato", name: "Gato", cls: "s-gato" },
    { key: "Perro", name: "Perro", cls: "s-perro" },
    { key: "Perro y gato", name: "Perro y gato", cls: "s-ambos" }
  ];
  return e === "ALL" ? all.slice(0, 2) : all.filter(s => s.key === e);
}

function renderTypeChart(filtered) {
  const series = typeSeries();
  const card = $("#chart-type").closest(".card");
  const legend = $(".legend", card);
  legend.hidden = series.length < 2;
  legend.innerHTML = series.map(s => `<span><i class="sw ${s.cls}"></i>${escapeHTML(s.name)}</span>`).join("");

  const cell = (c, s) => {
    const vals = filtered.filter(r => r.clasificacion === c && r.especie === s).map(r => r.precio_kg);
    const st = calcStats(vals);
    return { value: st.median, n: st.n };
  };
  const categories = OPTIONS.clasificaciones.map(c => ({ key: c, label: SHORT_CLASIF[c] || c }));
  const chartEl = $("#chart-type");
  if (!chartEl.hidden) {
    Charts.groupedBars(chartEl, {
      categories, series, value: cell,
      format: fmtCLP, short: fmtShort, tick: fmtShort,
      ariaLabel: "Precio típico por kilo según tipo de alimento"
    });
  }
  const rows = [];
  categories.forEach(c => series.forEach(s => {
    const d = cell(c.key, s.key);
    if (d.n) rows.push([c.key, s.name, fmtCLP(d.value), String(d.n)]);
  }));
  $("#chart-type-table").innerHTML = simpleTable(
    [{ label: "Tipo" }, { label: "Especie" }, { label: "Precio típico por kilo", num: true }, { label: "Productos", num: true }], rows);
}

function renderStoreChart(bySpecies) {
  const rows = DB.stores.map(s => {
    const st = calcStats(bySpecies.filter(r => r.comercio === s.nombre).map(r => r.precio_kg));
    return { label: s.nombre, ...st };
  });
  const chartEl = $("#chart-store");
  if (!chartEl.hidden) {
    Charts.rangeRows(chartEl, { rows, format: fmtCLP, tick: fmtShort, ariaLabel: "Precio típico por kilo en cada comercio" });
  }
  $("#chart-store-table").innerHTML = simpleTable(
    [{ label: "Comercio" }, { label: "Precio típico", num: true }, { label: "La mayoría entre", num: true }, { label: "Productos", num: true }],
    rows.filter(r => r.n).map(r => [r.label, fmtCLP(r.median), `${fmtCLP(r.p25)} – ${fmtCLP(r.p75)}`, String(r.n)]));
}

function renderDeals(bySpecies) {
  const groups = new Map();
  bySpecies.forEach(r => {
    const k = productKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const deals = [];
  groups.forEach(list => {
    if (new Set(list.map(x => x.comercio)).size < 2) return;
    const sorted = [...list].sort((a, b) => a.precio - b.precio);
    const lo = sorted[0], hi = sorted[sorted.length - 1];
    if (hi.precio > lo.precio) deals.push({ lo, hi, diff: (hi.precio - lo.precio) / lo.precio * 100 });
  });
  deals.sort((a, b) => b.diff - a.diff);

  $("#deals-sub").textContent = deals.length
    ? `${deals.length} producto${deals.length === 1 ? "" : "s"} idéntico${deals.length === 1 ? "" : "s"} cuesta${deals.length === 1 ? "" : "n"} distinto según el comercio. Considera todos los comercios.`
    : "Cuando el mismo producto tenga precio en dos o más comercios, aparecerá aquí.";
  const shown = ui.home.showAllDeals ? deals : deals.slice(0, 5);
  $("#deal-list").innerHTML = shown.map(d => `
    <li class="deal">
      <div class="deal-main">
        <div class="deal-title">${escapeHTML(d.lo.marca)} · ${escapeHTML(d.lo.producto)}</div>
        <div class="deal-sub">${escapeHTML(d.lo.especie)} · ${fmtGrams(d.lo.peso_gr)}</div>
      </div>
      <div class="deal-prices">
        <span><span class="muted">Más barato</span> <strong>${escapeHTML(d.lo.comercio)} ${fmtCLP(d.lo.precio)}</strong></span>
        <span><span class="muted">Más caro</span> ${escapeHTML(d.hi.comercio)} ${fmtCLP(d.hi.precio)}</span>
      </div>
      <div class="deal-diff">+${fmtPct(d.diff)}<span>más caro</span></div>
    </li>`).join("");
  $("#deals-foot").innerHTML = deals.length > 5
    ? `<button type="button" class="link-btn" id="deals-more">${ui.home.showAllDeals ? "Mostrar menos" : `Ver los ${deals.length}`}</button>`
    : "";
  const more = $("#deals-more");
  if (more) more.addEventListener("click", () => { ui.home.showAllDeals = !ui.home.showAllDeals; renderDeals(bySpecies); });
}

function renderDetail(filtered) {
  const r = pearson(filtered.map(x => x.peso_gr), filtered.map(x => x.precio_kg));
  $("#scatter-sub").textContent = "Cada punto es un producto. Toca o pasa el cursor para ver cuál es." +
    (r !== null ? ` Correlación de Pearson: r = ${r.toFixed(2).replace(".", ",")}.` : "");
  Charts.scatter($("#chart-scatter"), {
    points: filtered.map(x => ({ x: x.peso_gr, y: x.precio_kg, cls: SPECIES_CLASS[x.especie] || "s-gato", item: x })),
    xTick: v => Math.round(v) + " g", yTick: fmtShort,
    tip: x => `<strong>${escapeHTML(x.marca)} · ${escapeHTML(x.producto)}</strong><br>${escapeHTML(x.especie)} · ${fmtGrams(x.peso_gr)} · ${escapeHTML(x.comercio)}<br>${fmtCLP(x.precio)} · ${fmtCLP(x.precio_kg)} por kg`,
    ariaLabel: "Peso del envase versus precio por kilo"
  });

  const byProt = new Map();
  filtered.forEach(x => {
    const p = x.proteina || "Sin dato";
    if (!byProt.has(p)) byProt.set(p, []);
    byProt.get(p).push(x.precio_kg);
  });
  const protRows = Array.from(byProt.entries())
    .map(([label, vals]) => ({ label, n: vals.length, value: calcStats(vals).median }))
    .sort((a, b) => b.n - a.n).slice(0, 8)
    .sort((a, b) => b.value - a.value);
  const protEl = $("#chart-protein");
  if (!protEl.hidden) Charts.hbars(protEl, { rows: protRows, format: fmtCLP, ariaLabel: "Precio típico por kilo por proteína" });
  $("#chart-protein-table").innerHTML = simpleTable(
    [{ label: "Proteína" }, { label: "Precio típico por kilo", num: true }, { label: "Productos", num: true }],
    protRows.map(p => [p.label, fmtCLP(p.value), String(p.n)]));

  const groups = new Map();
  filtered.forEach(x => {
    const k = x.especie + "||" + x.clasificacion;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  });
  const rows = Array.from(groups.entries()).map(([k, items]) => {
    const [especie, clasificacion] = k.split("||");
    return { especie, clasificacion, ...calcStats(items.map(i => i.precio_kg)), w: calcStats(items.map(i => i.peso_gr)).median };
  }).sort((a, b) => b.n - a.n);
  $("#stats-body").innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td><span class="tag ${SPECIES_CLASS[r.especie] || ""}"><i class="sw ${SPECIES_CLASS[r.especie] || ""}"></i>${escapeHTML(r.especie)}</span></td>
      <td>${escapeHTML(r.clasificacion)}</td>
      <td class="num">${r.n}</td>
      <td class="num strong">${fmtCLP(r.median)}</td>
      <td class="num">${fmtCLP(r.mean)}</td>
      <td class="num">${fmtCLP(r.sd)}</td>
      <td class="num muted">${fmtCLP(r.p25)} – ${fmtCLP(r.p75)}</td>
      <td class="num">${fmtGrams(Math.round(r.w))}</td>
    </tr>`).join("") : `<tr><td colspan="8" class="empty-cell">No hay datos para este filtro.</td></tr>`;
}

function setupHome() {
  bindSegmented($("#home-species"), v => { ui.home.especie = v; renderHome(); });
  $("#home-store").addEventListener("change", e => { ui.home.comercio = e.target.value; renderHome(); });
  $("#detail-toggle").addEventListener("click", e => {
    ui.home.detail = !ui.home.detail;
    e.currentTarget.setAttribute("aria-expanded", String(ui.home.detail));
    $("#detail").hidden = !ui.home.detail;
    if (ui.home.detail) renderDetail(homeData().filtered);
  });
  toggleTableButtons();
}

/* ==========================================================================
   AGREGAR PRECIO
   ========================================================================== */
function productCatalog() {
  const map = new Map();
  DB.records.forEach(r => {
    const k = productKey(r);
    const cur = map.get(k);
    if (!cur) map.set(k, { ...r, prices: [r] });
    else {
      cur.prices.push(r);
      if (compareDateDesc(r, cur) < 0) Object.assign(cur, { ...r, prices: cur.prices });
    }
  });
  return Array.from(map.values());
}

function renderAdd() {
  renderStoreChips();
  if (!$("#f-fecha").value) $("#f-fecha").value = todayISO();
  renderProductResults();
  updatePriceResult();
}

function renderStoreChips() {
  if (!ui.add.comercio || !DB.stores.some(s => s.nombre === ui.add.comercio)) ui.add.comercio = DB.stores[0]?.nombre || null;
  $("#f-comercio").innerHTML = DB.stores.map(s => `
    <button type="button" role="radio" class="chip" data-value="${escapeHTML(s.nombre)}" aria-checked="${s.nombre === ui.add.comercio}">${escapeHTML(s.nombre)}</button>`).join("");
  bindSegmented($("#f-comercio"), v => { ui.add.comercio = v; updatePriceResult(); });
}

function renderProductResults() {
  const q = fold($("#product-search").value).trim();
  const list = $("#product-results");
  if (!q) { list.innerHTML = ""; return; }
  const tokens = q.split(/\s+/);
  const matches = productCatalog().filter(p => {
    const hay = fold(`${p.marca} ${p.producto} ${p.sabor} ${p.proteina} ${p.peso_gr}g ${p.especie}`);
    return tokens.every(t => hay.includes(t));
  }).sort((a, b) => a.marca.localeCompare(b.marca, "es") || a.producto.localeCompare(b.producto, "es") || a.peso_gr - b.peso_gr)
    .slice(0, 8);
  if (!matches.length) {
    list.innerHTML = `<li class="result-empty">No encontramos «${escapeHTML($("#product-search").value.trim())}». Si es nuevo, usa «Es un producto nuevo».</li>`;
    return;
  }
  list.innerHTML = matches.map((p, i) => `
    <li>
      <button type="button" class="result" data-i="${i}">
        <span class="result-title">${escapeHTML(p.marca)} · ${escapeHTML(p.producto)}</span>
        <span class="result-sub">${escapeHTML(p.especie)} · ${fmtGrams(p.peso_gr)} · ${escapeHTML(p.formato)} · último precio ${fmtCLP(p.precio)} en ${escapeHTML(p.comercio)}</span>
      </button>
    </li>`).join("");
  $$(".result", list).forEach(btn => btn.addEventListener("click", () => chooseProduct(matches[Number(btn.dataset.i)])));
}

function setProductFields(p) {
  $("#f-marca").value = p.marca || "";
  $("#f-producto").value = p.producto || "";
  ui.add.especie = p.especie || "Gato";
  setSegmented($("#f-especie"), ui.add.especie);
  $("#f-peso").value = p.peso_gr ? String(p.peso_gr).replace(".", ",") : "";
  $("#f-formato").value = p.formato || "Lata";
  $("#f-clasificacion").value = p.clasificacion || "Alimento completo";
  $("#f-etapa").value = p.etapa || "Adulto";
  if (p.textura && !OPTIONS.texturas.includes(p.textura)) fillSelect($("#f-textura"), [...OPTIONS.texturas, p.textura], p.textura);
  $("#f-textura").value = p.textura || "Paté";
  $("#f-proteina").value = p.proteina || "";
  $("#f-sabor").value = p.sabor || "";
}

function chooseProduct(p) {
  ui.add.product = p;
  ui.add.isNew = false;
  setProductFields(p);
  $("#product-picker").hidden = true;
  $("#product-fields").hidden = true;
  $("#product-chosen").hidden = false;
  $("#chosen-title").textContent = `${p.marca} · ${p.producto}`;
  $("#chosen-sub").textContent = `${p.especie} · ${fmtGrams(p.peso_gr)} · ${p.formato} · ${p.clasificacion}`;
  clearErrors();
  updatePriceResult();
  $("#f-precio").focus();
}

function startNewProduct() {
  ui.add.product = null;
  ui.add.isNew = true;
  const q = $("#product-search").value.trim();
  setProductFields({ especie: ui.add.especie });
  const brand = DB.records.find(r => q && fold(q).startsWith(fold(r.marca) + " "));
  if (brand) { $("#f-marca").value = brand.marca; $("#f-producto").value = q.slice(brand.marca.length).trim(); }
  else if (q) $("#f-producto").value = q;
  $("#product-picker").hidden = true;
  $("#product-chosen").hidden = false;
  $("#chosen-title").textContent = "Producto nuevo";
  $("#chosen-sub").textContent = "Completa los datos del envase.";
  $("#product-fields").hidden = false;
  clearErrors();
  updatePriceResult();
  $("#f-marca").focus();
}

function resetProduct() {
  ui.add.product = null;
  ui.add.isNew = false;
  $("#product-picker").hidden = false;
  $("#product-chosen").hidden = true;
  $("#product-fields").hidden = true;
  $("#product-search").value = "";
  renderProductResults();
  clearErrors();
  updatePriceResult();
}

function readAddForm() {
  const store = DB.stores.find(s => s.nombre === ui.add.comercio);
  return {
    marca: cleanText($("#f-marca").value),
    producto: cleanText($("#f-producto").value),
    especie: ui.add.especie,
    etapa: $("#f-etapa").value,
    clasificacion: $("#f-clasificacion").value,
    textura: $("#f-textura").value,
    sabor: cleanText($("#f-sabor").value),
    proteina: cleanText($("#f-proteina").value),
    peso_gr: parseNumberCL($("#f-peso").value),
    formato: $("#f-formato").value,
    comercio: ui.add.comercio || "",
    canal: store ? store.canal : "",
    precio: parseNumberCL($("#f-precio").value),
    fecha: $("#f-fecha").value || null
  };
}

function clearErrors() {
  $$(".field-error").forEach(e => { e.hidden = true; e.textContent = ""; });
  $$("[aria-invalid]").forEach(e => e.removeAttribute("aria-invalid"));
}
function setError(field, msg) {
  const input = $("#f-" + field);
  const err = $("#e-" + field);
  if (input) input.setAttribute("aria-invalid", "true");
  if (err) { err.textContent = msg; err.hidden = false; if (input) input.setAttribute("aria-describedby", err.id); }
}

function validateAdd(rec) {
  clearErrors();
  const errors = [];
  if (!ui.add.product && !ui.add.isNew) {
    showToast({ title: "Falta elegir el producto", message: "Búscalo arriba o toca «Es un producto nuevo».", tone: "info" });
    $("#product-search").focus();
    return false;
  }
  if (!rec.marca) errors.push(["marca", "Escribe la marca."]);
  if (!rec.producto) errors.push(["producto", "Escribe el nombre del producto."]);
  if (!(rec.peso_gr > 0) || rec.peso_gr > 20000) errors.push(["peso", "Escribe el peso en gramos, por ejemplo 400."]);
  if (!(rec.precio > 0)) errors.push(["precio", "Escribe el precio, por ejemplo 5.490."]);
  else if (rec.precio < 100) errors.push(["precio", "El precio parece muy bajo. Escríbelo completo, por ejemplo 1.290."]);
  if (!rec.comercio) { showToast({ title: "Elige un comercio", tone: "info" }); return false; }
  if (errors.length) {
    const needsProductFields = errors.some(([f]) => f !== "precio");
    if (needsProductFields && $("#product-fields").hidden) $("#product-fields").hidden = false;
    errors.forEach(([f, m]) => setError(f, m));
    $("#f-" + errors[0][0]).focus();
    return false;
  }
  return true;
}

function updatePriceResult() {
  const panel = $("#price-result");
  const rec = readAddForm();
  if (!(rec.peso_gr > 0) || !(rec.precio > 0)) {
    panel.className = "result-panel";
    panel.innerHTML = `<span class="muted">Escribe el precio para ver cuánto cuesta el kilo.</span>`;
    return;
  }
  const kg = rec.precio / rec.peso_gr * 1000;
  const peers = latestPrices(DB.records).filter(r => r.especie === rec.especie && r.clasificacion === rec.clasificacion).map(r => r.precio_kg);
  const typical = calcStats(peers).median;
  let tone = "ok", msg = "";
  if (rec.precio < 100) {
    tone = "warn"; msg = "El precio parece incompleto. Escríbelo completo, por ejemplo 1.290.";
  } else if (typical > 0 && peers.length >= 3) {
    const ratio = kg / typical;
    const what = `${rec.clasificacion.toLowerCase()} para ${rec.especie.toLowerCase()}`;
    if (ratio > 2.2) { tone = "warn"; msg = `Muy por encima de lo habitual en ${what} (típico ${fmtCLP(typical)} por kilo). Revisa el precio y el peso.`; }
    else if (ratio < 0.45) { tone = "warn"; msg = `Muy por debajo de lo habitual en ${what} (típico ${fmtCLP(typical)} por kilo). Revisa el precio y el peso.`; }
    else msg = `Dentro de lo habitual en ${what} (típico ${fmtCLP(typical)} por kilo).`;
  }
  let prevLine = "";
  if (ui.add.product) {
    const prev = DB.records
      .filter(r => productKey(r) === productKey(rec) && r.comercio === rec.comercio && (r.fecha || "") !== (rec.fecha || ""))
      .sort(compareDateDesc)[0];
    if (prev) {
      const ch = (rec.precio - prev.precio) / prev.precio * 100;
      const verb = Math.abs(ch) < 0.5 ? "igual" : ch > 0 ? `sube ${fmtPct(ch)}` : `baja ${fmtPct(ch)}`;
      prevLine = `<div class="result-prev">Antes en ${escapeHTML(rec.comercio)}: ${fmtCLP(prev.precio)} (${escapeHTML(fmtDate(prev.fecha))}) · ${verb}</div>`;
    }
  }
  panel.className = `result-panel tone-${tone}`;
  panel.innerHTML = `
    <div class="result-kg"><span class="result-kg-value">${fmtCLP(kg)}</span> por kilo</div>
    ${msg ? `<div class="result-msg"><svg class="icon"><use href="#${tone === "ok" ? "i-check" : "i-warn"}"/></svg>${escapeHTML(msg)}</div>` : ""}
    ${prevLine}`;
}

async function saveAdd(nextStore) {
  const rec = readAddForm();
  if (!validateAdd(rec)) return;
  const res = await DataStore.upsert(rec);
  afterDataChange();
  showToast({
    title: res.mode === "updated" ? "Precio actualizado" : "Precio guardado",
    message: `${rec.marca} · ${rec.producto} en ${rec.comercio}: ${fmtCLP(rec.precio)} (${fmtCLP(res.record.precio_kg)} por kilo)`,
    action: {
      label: "Deshacer",
      fn: async () => {
        if (res.mode === "inserted") await DataStore.remove(res.record.id);
        else await DataStore.revert(res.previous);
        afterDataChange();
        if (ui.route === "agregar") updatePriceResult();
        showToast({ title: "Cambio deshecho", tone: "info" });
      }
    }
  });
  $("#f-precio").value = "";
  if (nextStore) {
    const idx = DB.stores.findIndex(s => s.nombre === rec.comercio);
    ui.add.comercio = DB.stores[(idx + 1) % DB.stores.length].nombre;
    // El producto ya existe en la base: se trata como elegido.
    chooseProduct(productCatalog().find(p => productKey(p) === productKey(rec)) || ui.add.product);
    renderStoreChips();
  } else {
    resetProduct();
    $("#product-search").focus();
  }
  updatePriceResult();
}

function setupAdd() {
  fillSelect($("#f-formato"), OPTIONS.formatos, "Lata");
  fillSelect($("#f-clasificacion"), OPTIONS.clasificaciones, "Alimento completo");
  fillSelect($("#f-etapa"), OPTIONS.etapas, "Adulto");
  fillSelect($("#f-textura"), OPTIONS.texturas, "Paté");
  $("#weight-presets").innerHTML = OPTIONS.pesos.map(g => `<button type="button" class="chip chip-sm" data-g="${g}">${g} g</button>`).join("");
  $$("#weight-presets .chip").forEach(b => b.addEventListener("click", () => { $("#f-peso").value = b.dataset.g; updatePriceResult(); }));
  bindSegmented($("#f-especie"), v => { ui.add.especie = v; updatePriceResult(); });

  $("#product-search").addEventListener("input", renderProductResults);
  $("#product-search").addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { const first = $("#product-results .result"); if (first) { e.preventDefault(); first.focus(); } }
    if (e.key === "Enter") { e.preventDefault(); const first = $("#product-results .result"); if (first) first.click(); }
  });
  $("#product-results").addEventListener("keydown", e => {
    const items = $$("#product-results .result");
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === "ArrowDown" && items[i + 1]) { e.preventDefault(); items[i + 1].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (items[i - 1] || $("#product-search")).focus(); }
  });
  $("#new-product-btn").addEventListener("click", startNewProduct);
  $("#change-product").addEventListener("click", () => { resetProduct(); $("#product-search").focus(); });
  ["#f-precio", "#f-peso", "#f-fecha", "#f-clasificacion"].forEach(s => $(s).addEventListener("input", updatePriceResult));
  $("#add-form").addEventListener("submit", e => { e.preventDefault(); saveAdd(false); });
  $("#save-next").addEventListener("click", () => saveAdd(true));
}

/* ==========================================================================
   PRODUCTOS (lista, edición y borrado)
   ========================================================================== */
function listFiltered() {
  const tokens = fold(ui.list.q).trim().split(/\s+/).filter(Boolean);
  let rows = DB.records.filter(r => {
    if (ui.list.especie !== "ALL" && r.especie !== ui.list.especie) return false;
    if (ui.list.comercio !== "ALL" && r.comercio !== ui.list.comercio) return false;
    if (!tokens.length) return true;
    const hay = fold(`${r.marca} ${r.producto} ${r.sabor} ${r.proteina} ${r.comercio} ${r.especie} ${r.clasificacion} ${r.textura} ${r.peso_gr}g`);
    return tokens.every(t => hay.includes(t));
  });
  const s = ui.list.sort;
  if (s === "recent") rows.sort(compareDateDesc);
  else if (s === "brand") rows.sort((a, b) => a.marca.localeCompare(b.marca, "es") || a.producto.localeCompare(b.producto, "es"));
  else if (s === "kg-asc") rows.sort((a, b) => a.precio_kg - b.precio_kg);
  else if (s === "kg-desc") rows.sort((a, b) => b.precio_kg - a.precio_kg);
  return rows;
}

function renderList() {
  ui.list.comercio = syncStoreSelect($("#list-store"), ui.list.comercio);

  const rows = listFiltered();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  ui.list.page = Math.min(ui.list.page, pages - 1);
  const start = ui.list.page * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  $("#list-caption").textContent = `${DB.records.length.toLocaleString("es-CL")} precios guardados. Toca una fila para corregirla o eliminarla.`;
  $("#list-body").innerHTML = pageRows.length ? pageRows.map(r => `
    <tr tabindex="0" data-id="${escapeHTML(r.id)}" aria-label="Editar ${escapeHTML(r.marca)} ${escapeHTML(r.producto)} en ${escapeHTML(r.comercio)}">
      <td class="cell-product">
        <div class="row-title">${escapeHTML(r.marca)} · ${escapeHTML(r.producto)}</div>
        <div class="row-sub"><i class="sw ${SPECIES_CLASS[r.especie] || ""}"></i>${escapeHTML(r.especie)} · ${fmtGrams(r.peso_gr)} · ${escapeHTML(r.formato)}</div>
      </td>
      <td class="cell-store">${escapeHTML(r.comercio)}</td>
      <td class="cell-date">${escapeHTML(fmtDate(r.fecha))}</td>
      <td class="num cell-price">${fmtCLP(r.precio)}</td>
      <td class="num cell-kg strong">${fmtCLP(r.precio_kg)}<span class="unit">/kg</span></td>
    </tr>`).join("")
    : `<tr><td colspan="5" class="empty-cell">No hay precios que coincidan con la búsqueda.</td></tr>`;

  $("#pager-label").textContent = rows.length
    ? `Mostrando ${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} de ${rows.length.toLocaleString("es-CL")}`
    : "Sin resultados";
  $("#pager-prev").disabled = ui.list.page === 0;
  $("#pager-next").disabled = ui.list.page >= pages - 1;
}

function editFieldsHTML(r) {
  const opt = (vals, cur) => {
    const list = vals.includes(cur) || !cur ? vals : [...vals, cur];
    return list.map(v => `<option${v === cur ? " selected" : ""}>${escapeHTML(v)}</option>`).join("");
  };
  const stores = DB.stores.map(s => s.nombre);
  return `
    <div class="form-grid">
      <div class="field"><label for="x-marca">Marca</label><input id="x-marca" class="input" value="${escapeHTML(r.marca)}" list="dl-marcas" /></div>
      <div class="field span-2"><label for="x-producto">Producto</label><input id="x-producto" class="input" value="${escapeHTML(r.producto)}" /></div>
      <div class="field"><label for="x-especie">Para</label><select id="x-especie" class="select">${opt(OPTIONS.especies, r.especie)}</select></div>
      <div class="field"><label for="x-peso">Peso neto (g)</label><input id="x-peso" class="input" inputmode="decimal" value="${escapeHTML(String(r.peso_gr).replace(".", ","))}" /></div>
      <div class="field"><label for="x-formato">Envase</label><select id="x-formato" class="select">${opt(OPTIONS.formatos, r.formato)}</select></div>
      <div class="field"><label for="x-clasificacion">Tipo de alimento</label><select id="x-clasificacion" class="select">${opt(OPTIONS.clasificaciones, r.clasificacion)}</select></div>
      <div class="field"><label for="x-etapa">Etapa de vida</label><select id="x-etapa" class="select">${opt(OPTIONS.etapas, r.etapa)}</select></div>
      <div class="field"><label for="x-textura">Textura</label><select id="x-textura" class="select">${opt(OPTIONS.texturas, r.textura)}</select></div>
      <div class="field"><label for="x-proteina">Proteína principal</label><input id="x-proteina" class="input" value="${escapeHTML(r.proteina)}" list="dl-proteinas" /></div>
      <div class="field span-2"><label for="x-sabor">Sabor</label><input id="x-sabor" class="input" value="${escapeHTML(r.sabor)}" /></div>
      <div class="field"><label for="x-comercio">Comercio</label><select id="x-comercio" class="select">${opt(stores, r.comercio)}</select></div>
      <div class="field"><label for="x-precio">Precio</label><div class="input-prefix"><span aria-hidden="true">$</span><input id="x-precio" class="input" inputmode="numeric" value="${escapeHTML(Math.round(r.precio).toLocaleString("es-CL"))}" /></div></div>
      <div class="field"><label for="x-fecha">Fecha</label><input id="x-fecha" type="date" class="input" value="${escapeHTML(r.fecha || "")}" /><p class="hint">Vacía = estudio inicial</p></div>
    </div>
    <p class="field-error" id="x-error" hidden></p>`;
}

function openEdit(id) {
  const r = DB.records.find(x => x.id === id);
  if (!r) return;
  const editFoot = `
    <button type="button" class="btn btn-destructive" data-act="delete"><svg class="icon"><use href="#i-trash"/></svg>Eliminar</button>
    <span class="spacer"></span>
    <button type="button" class="btn btn-secondary" data-act="cancel">Cancelar</button>
    <button type="button" class="btn btn-primary" data-act="save">Guardar cambios</button>`;

  const mount = el => {
    $('[data-act="cancel"]', el).addEventListener("click", () => sheet.close());
    $('[data-act="save"]', el).addEventListener("click", async () => {
      const store = DB.stores.find(s => s.nombre === $("#x-comercio").value);
      const patch = {
        marca: cleanText($("#x-marca").value),
        producto: cleanText($("#x-producto").value),
        especie: $("#x-especie").value,
        peso_gr: parseNumberCL($("#x-peso").value),
        formato: $("#x-formato").value,
        clasificacion: $("#x-clasificacion").value,
        etapa: $("#x-etapa").value,
        textura: $("#x-textura").value,
        proteina: cleanText($("#x-proteina").value),
        sabor: cleanText($("#x-sabor").value),
        comercio: $("#x-comercio").value,
        canal: store ? store.canal : r.canal,
        precio: parseNumberCL($("#x-precio").value),
        fecha: $("#x-fecha").value || null
      };
      const err = $("#x-error");
      const problem = !patch.marca ? "Falta la marca." : !patch.producto ? "Falta el nombre del producto."
        : !(patch.peso_gr > 0) ? "El peso no es válido." : !(patch.precio >= 100) ? "El precio no es válido (escríbelo completo, ej: 1.290)." : "";
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      const res = await DataStore.update(id, patch);
      sheet.close();
      afterDataChange();
      renderList();
      showToast({
        title: "Cambios guardados",
        message: `${patch.marca} · ${patch.producto}`,
        action: { label: "Deshacer", fn: async () => { await DataStore.revert(res.previous); afterDataChange(); renderRoute(); showToast({ title: "Cambio deshecho", tone: "info" }); } }
      });
    });
    $('[data-act="delete"]', el).addEventListener("click", () => {
      $("#sheet-foot").innerHTML = `
        <span class="confirm-text">¿Eliminar este precio?</span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-secondary" data-act="no">No</button>
        <button type="button" class="btn btn-destructive-fill" data-act="yes">Eliminar</button>`;
      $('[data-act="no"]').addEventListener("click", () => { $("#sheet-foot").innerHTML = editFoot; mount(el); });
      $('[data-act="yes"]').addEventListener("click", async () => {
        const res = await DataStore.remove(id);
        sheet.close();
        afterDataChange();
        renderList();
        showToast({
          title: "Precio eliminado",
          message: `${r.marca} · ${r.producto} en ${r.comercio}`,
          action: { label: "Deshacer", fn: async () => { await DataStore.restore(res.record, res.index); afterDataChange(); renderRoute(); showToast({ title: "Precio recuperado", tone: "info" }); } }
        });
      });
      $('[data-act="no"]').focus();
    });
  };

  sheet.open({
    title: "Editar precio",
    body: editFieldsHTML(r),
    foot: editFoot,
    onMount: mount
  });
}

function setupList() {
  let t = null;
  $("#list-search").addEventListener("input", e => {
    clearTimeout(t);
    t = setTimeout(() => { ui.list.q = e.target.value; ui.list.page = 0; renderList(); }, 120);
  });
  bindSegmented($("#list-species"), v => { ui.list.especie = v; ui.list.page = 0; renderList(); });
  $("#list-store").addEventListener("change", e => { ui.list.comercio = e.target.value; ui.list.page = 0; renderList(); });
  $("#list-sort").addEventListener("change", e => { ui.list.sort = e.target.value; ui.list.page = 0; renderList(); });
  $("#pager-prev").addEventListener("click", () => { ui.list.page--; renderList(); $("#view-productos .table-card").scrollIntoView({ block: "start" }); });
  $("#pager-next").addEventListener("click", () => { ui.list.page++; renderList(); $("#view-productos .table-card").scrollIntoView({ block: "start" }); });
  $("#list-body").addEventListener("click", e => { const tr = e.target.closest("tr[data-id]"); if (tr) openEdit(tr.dataset.id); });
  $("#list-body").addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const tr = e.target.closest("tr[data-id]");
    if (tr) { e.preventDefault(); openEdit(tr.dataset.id); }
  });
}

/* ==========================================================================
   IMPORTAR
   ========================================================================== */
const FIELD_ALIASES = {
  marca: ["marcas", "marca"],
  producto: ["producto", "nombredelproducto", "nombre"],
  especie: ["especie2", "especie"],
  etapa: ["etapadevida", "etapa"],
  clasificacion: ["clasificacionnutricional20", "clasificacionnutricional", "clasificacion", "tipodealimento"],
  textura: ["tipotextura", "textura"],
  sabor: ["sabor2", "sabordeclarado", "sabor"],
  proteina: ["proteina", "ingredienteproteinaprincipal", "proteinaprincipal"],
  peso_gr: ["pesonetogr", "pesogr", "pesoneto", "peso", "pesog"],
  formato: ["formatoenvase", "formato", "envase"],
  comercio: ["comercio"],
  canal: ["canaldeventa", "canal"],
  precio: ["precio", "precioclp"],
  fecha: ["fecha", "fechadelevantamiento", "fechalevantamiento"]
};
const EXCEL_LAYOUT = ["Marca", "MARCAS", "Producto", "Especie", "ESPECIE2", "Etapa de vida", "Clasificación nutricional", "Clasificación nutricional 2.0", "Tipo/textura", "Sabor declarado", "SABOR 2", "Ingrediente/proteína principal", "PROTEÍNA", "Peso neto gr", "Formato envase", "Material envase", "Comercio", "Canal de venta", "Precio", "Precio por kg"];
const APP_LAYOUT = ["Marca", "Producto", "Especie", "Etapa de vida", "Tipo de alimento", "Textura", "Sabor", "Proteína", "Peso neto gr", "Envase", "Comercio", "Canal", "Precio", "Fecha"];

const headerKey = h => fold(h).replace(/[^a-z0-9]/g, "");

function mapHeaders(headerRow) {
  const keys = headerRow.map(headerKey);
  const map = {};
  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    map[field] = aliases.map(a => keys.indexOf(a)).filter(i => i >= 0);
  });
  const found = Object.values(map).filter(v => v.length).length;
  return { map, found, ok: map.precio.length && (map.producto.length || map.marca.length) && found >= 4 };
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const m = mapHeaders(rows[i].map(c => String(c ?? "")));
    if (m.ok) return { index: i, map: m.map };
  }
  return null;
}

function parseDelimited(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";
  const sep = firstLine.includes("\t") ? "\t" : (firstLine.split(";").length > firstLine.split(",").length ? ";" : ",");
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") inQ = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function toISODate(v) {
  if (v === "" || v == null) return { value: null, ok: true };
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return { value: d.toISOString().slice(0, 10), ok: true };
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return { value: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`, ok: true };
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (m) return { value: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`, ok: true };
  return { value: null, ok: false };
}

function matchSpecies(v) {
  const k = headerKey(v);
  if (k === "gato" || k === "gatos" || k === "felino") return "Gato";
  if (k === "perro" || k === "perros" || k === "canino") return "Perro";
  if (k === "perroygato" || k === "ambos" || k === "gatoyperro" || k === "perrogato") return "Perro y gato";
  return null;
}

function buildImport(rows, sourceLabel) {
  let header = findHeader(rows);
  let dataRows, layoutNote = "";
  if (header) {
    dataRows = rows.slice(header.index + 1).map((r, i) => ({ r, line: header.index + 2 + i }));
  } else {
    const width = Math.max(...rows.map(r => r.length));
    const layout = width >= 19 ? EXCEL_LAYOUT : APP_LAYOUT;
    header = { map: mapHeaders(layout).map };
    dataRows = rows.map((r, i) => ({ r, line: i + 1 }));
    layoutNote = width >= 19 ? " · columnas en el orden del Excel del estudio" : " · columnas en el orden de esta app";
  }
  const map = header.map;
  const get = (r, field) => {
    for (const i of map[field] || []) {
      const v = r[i];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return "";
  };

  const knownStores = new Map(DB.stores.map(s => [fold(s.nombre), s]));
  const newStores = new Set();
  const items = [];
  let blank = 0;

  dataRows.forEach(({ r, line }) => {
    const marca = cleanText(get(r, "marca"));
    const producto = cleanText(get(r, "producto"));
    const precioRaw = get(r, "precio");
    if (!marca && !producto && precioRaw === "") { blank++; return; }

    const problems = [], warnings = [];
    const especieRaw = cleanText(get(r, "especie"));
    const especie = matchSpecies(especieRaw);
    const peso = parseNumberCL(get(r, "peso_gr"));
    const precio = parseNumberCL(precioRaw);
    let comercio = cleanText(get(r, "comercio"));
    let canal = cleanText(get(r, "canal"));
    const fecha = toISODate(get(r, "fecha"));

    if (!marca) problems.push("Falta la marca");
    if (!producto) problems.push("Falta el producto");
    if (!especie) problems.push(especieRaw ? `Especie desconocida «${especieRaw}»` : "Falta la especie");
    if (!(peso > 0)) problems.push("Peso no válido");
    if (!(precio > 0)) problems.push("Precio no válido");
    else if (precio < 100) problems.push("Precio muy bajo (¿faltan los miles?)");
    if (!comercio) problems.push("Falta el comercio");

    if (comercio) {
      const known = knownStores.get(fold(comercio));
      if (known) { comercio = known.nombre; if (!canal) canal = known.canal; }
      else { newStores.add(comercio); if (!canal) canal = "Tienda de mascotas"; }
    }
    if (!fecha.ok) warnings.push("Fecha no reconocida: quedará como estudio inicial");
    const kg = peso > 0 && precio > 0 ? precio / peso * 1000 : 0;
    if (!problems.length && (kg < 2500 || kg > 150000)) warnings.push("Precio por kilo inusual, revísalo");
    if (comercio && newStores.has(comercio)) warnings.push(`Comercio nuevo «${comercio}»: se agregará`);

    items.push({
      line,
      status: problems.length ? "error" : warnings.length ? "warn" : "ok",
      reasons: problems.length ? problems : warnings,
      rec: {
        marca, producto, especie: especie || especieRaw,
        etapa: cleanText(get(r, "etapa")) || "Adulto",
        clasificacion: cleanText(get(r, "clasificacion")) || "Alimento completo",
        textura: cleanText(get(r, "textura")),
        sabor: cleanText(get(r, "sabor")),
        proteina: cleanText(get(r, "proteina")),
        peso_gr: peso, formato: cleanText(get(r, "formato")) || "Lata",
        comercio, canal, precio, fecha: fecha.value,
        precio_kg: kg
      }
    });
  });

  ui.importData = { items, blank, source: sourceLabel + layoutNote, newStores: [...newStores] };
  renderImport();
}

function renderImport() {
  const d = ui.importData;
  const card = $("#import-review");
  if (!d) { card.hidden = true; return; }
  card.hidden = false;
  const ok = d.items.filter(i => i.status === "ok").length;
  const warn = d.items.filter(i => i.status === "warn").length;
  const err = d.items.filter(i => i.status === "error").length;
  const usable = ok + warn;
  $("#import-source").textContent = d.source;
  $("#import-summary").innerHTML = `
    <span class="pill pill-ok"><svg class="icon"><use href="#i-check"/></svg>${usable} listas para importar</span>
    ${warn ? `<span class="pill pill-warn"><svg class="icon"><use href="#i-warn"/></svg>${warn} con avisos (se importan)</span>` : ""}
    ${err ? `<span class="pill pill-error"><svg class="icon"><use href="#i-warn"/></svg>${err} con problemas (no se importan)</span>` : ""}
    ${d.blank ? `<span class="pill">${d.blank} filas vacías ignoradas</span>` : ""}`;
  const commit = $("#import-commit");
  commit.textContent = usable ? `Importar ${usable} precio${usable === 1 ? "" : "s"}` : "No hay filas para importar";
  commit.disabled = !usable;

  const order = { error: 0, warn: 1, ok: 2 };
  const sorted = [...d.items].sort((a, b) => order[a.status] - order[b.status] || a.line - b.line);
  const shown = sorted.slice(0, 400);
  $("#import-body").innerHTML = shown.map(i => `
    <tr class="row-${i.status}">
      <td class="num muted">${i.line}</td>
      <td>${i.status === "ok" ? `<span class="status status-ok"><svg class="icon"><use href="#i-check"/></svg>Lista</span>`
        : `<span class="status status-${i.status}"><svg class="icon"><use href="#i-warn"/></svg>${escapeHTML(i.reasons.join(" · "))}</span>`}</td>
      <td><div class="row-title">${escapeHTML(i.rec.marca || "—")} · ${escapeHTML(i.rec.producto || "—")}</div><div class="row-sub">${escapeHTML(i.rec.especie || "—")} · ${i.rec.peso_gr > 0 ? fmtGrams(i.rec.peso_gr) : "—"}</div></td>
      <td>${escapeHTML(i.rec.comercio || "—")}</td>
      <td class="num">${i.rec.precio > 0 ? fmtCLP(i.rec.precio) : "—"}</td>
      <td class="num strong">${i.rec.precio_kg > 0 ? fmtCLP(i.rec.precio_kg) : "—"}</td>
    </tr>`).join("") + (sorted.length > shown.length ? `<tr><td colspan="6" class="empty-cell">Y ${sorted.length - shown.length} filas más.</td></tr>` : "");
}

async function readImportFile(file) {
  try {
    if (/\.xlsx$/i.test(file.name)) {
      const sheets = await Xlsx.read(await file.arrayBuffer());
      const sheetWithData = sheets.find(s => findHeader(s.rows));
      if (!sheetWithData) {
        showToast({ title: "No encontramos los datos", message: "Ninguna hoja tiene columnas como Marca, Producto y Precio.", tone: "error" });
        return;
      }
      buildImport(sheetWithData.rows, `${file.name} · hoja «${sheetWithData.name}»`);
    } else {
      const text = await file.text();
      buildImport(parseDelimited(text.replace(/^﻿/, "")), file.name);
    }
    $("#import-review").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  } catch (e) {
    showToast({ title: "No se pudo leer el archivo", message: e.message || "Verifica que sea un Excel (.xlsx) o CSV.", tone: "error" });
  }
}

async function commitImport() {
  const d = ui.importData;
  if (!d) return;
  const recs = d.items.filter(i => i.status !== "error").map(i => i.rec);
  if (!recs.length) return;
  const mode = $('input[name="import-mode"]:checked').value;
  if (mode === "replace") {
    const ok = await confirmSheet({
      title: "¿Reemplazar todos tus datos?",
      message: `Tus ${DB.records.length.toLocaleString("es-CL")} precios actuales se reemplazarán por los ${recs.length} de este archivo.`,
      confirmLabel: "Reemplazar",
      destructive: true,
      extraButton: { label: "Descargar copia antes", fn: downloadBackup }
    });
    if (!ok) return;
    const prev = DB.records.map(r => ({ ...r }));
    await DataStore.replaceAll(recs);
    afterDataChange();
    showToast({
      title: "Datos reemplazados",
      message: `Ahora tienes ${recs.length} precios.`,
      action: { label: "Deshacer", fn: async () => { await DataStore.replaceAll(prev); afterDataChange(); renderRoute(); showToast({ title: "Datos anteriores recuperados", tone: "info" }); } }
    });
  } else {
    const res = await DataStore.upsertMany(recs);
    afterDataChange();
    showToast({ title: "Importación lista", message: `${res.inserted} precios nuevos y ${res.updated} actualizados.` });
  }
  ui.importData = null;
  $("#import-file").value = "";
  $("#import-text").value = "";
  renderImport();
}

function setupImport() {
  const dz = $("#dropzone");
  $("#import-file").addEventListener("change", e => { const f = e.target.files[0]; if (f) readImportFile(f); });
  ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("is-over"); }));
  dz.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) readImportFile(f); });
  $("#import-text-btn").addEventListener("click", () => {
    const text = $("#import-text").value.trim();
    if (!text) { showToast({ title: "No hay nada pegado", tone: "info" }); return; }
    buildImport(parseDelimited(text), "Filas pegadas");
  });
  $("#import-commit").addEventListener("click", commitImport);
  $("#import-cancel").addEventListener("click", () => { ui.importData = null; $("#import-file").value = ""; renderImport(); });
}

/* ==========================================================================
   RESPALDO Y AJUSTES
   ========================================================================== */
async function downloadBackup() {
  const headers = [...APP_LAYOUT, "Precio por kg"];
  const rows = [headers, ...DB.records.map(r => [
    r.marca, r.producto, r.especie, r.etapa, r.clasificacion, r.textura, r.sabor, r.proteina,
    r.peso_gr, r.formato, r.comercio, r.canal, r.precio, r.fecha || "", r.precio_kg
  ])];
  const blob = Xlsx.write("Precios", rows, [16, 44, 12, 16, 22, 16, 28, 14, 12, 10, 16, 20, 10, 12, 14]);
  download(blob, `estudio-mercado-respaldo-${todayISO()}.xlsx`);
  await DataStore.setMeta({ lastBackupAt: new Date().toISOString() });
  refreshFromStore();
  renderStatus();
  if (ui.route === "respaldo") renderBackup();
  showToast({ title: "Copia descargada", message: `${DB.records.length} precios guardados en tu carpeta de descargas.` });
}

function renderBackup() {
  const meta = DB.meta || {};
  const el = $("#backup-status");
  if (!meta.lastBackupAt) {
    el.className = "backup-status tone-warn";
    el.innerHTML = `<svg class="icon"><use href="#i-warn"/></svg><span>Aún no has descargado ninguna copia. Te recomendamos hacerlo una vez por semana.</span>`;
  } else {
    const changed = meta.lastChangeAt && meta.lastChangeAt > meta.lastBackupAt;
    const late = changed && daysSince(meta.lastBackupAt) >= APP_CONFIG.backupReminderDays;
    el.className = `backup-status ${late ? "tone-warn" : "tone-ok"}`;
    el.innerHTML = `<svg class="icon"><use href="#${late ? "i-warn" : "i-check"}"/></svg><span>Última copia: ${fmtDateTime(meta.lastBackupAt)} (${relativeDays(meta.lastBackupAt)}).${changed ? " Hay cambios desde entonces." : " Sin cambios desde entonces."}</span>`;
  }

  const counts = new Map();
  DB.records.forEach(r => counts.set(r.comercio, (counts.get(r.comercio) || 0) + 1));
  $("#store-list").innerHTML = DB.stores.map((s, i) => {
    const c = counts.get(s.nombre) || 0;
    return `<li>
      <svg class="icon store-icon"><use href="#i-store"/></svg>
      <div class="store-main"><div class="row-title">${escapeHTML(s.nombre)}</div><div class="row-sub">${escapeHTML(s.canal)} · ${c} precio${c === 1 ? "" : "s"}</div></div>
      ${c ? "" : `<button type="button" class="icon-btn" data-remove-store="${i}" aria-label="Quitar ${escapeHTML(s.nombre)}"><svg class="icon"><use href="#i-trash"/></svg></button>`}
    </li>`;
  }).join("");
  $$("[data-remove-store]").forEach(b => b.addEventListener("click", async () => {
    const stores = DB.stores.filter((_, i) => i !== Number(b.dataset.removeStore));
    await DataStore.saveStores(stores);
    afterDataChange();
    renderBackup();
  }));

  const sql = SqlExport.build(DB.records);
  const lines = sql.split("\n");
  $("#sql-preview").textContent = lines.slice(0, 160).join("\n") + (lines.length > 160 ? `\n\n-- … y ${lines.length - 160} líneas más (descarga el archivo para verlo completo)` : "");
}

/* Créditos de las fotos de fondo (licencias abiertas; CC BY y CC BY-SA exigen crédito). */
const PHOTO_CREDITS = {
  gato: { title: "A kitten in the hand", author: "Leo Rodman", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/deed.es", page: "https://commons.wikimedia.org/wiki/File:A_kitten_in_the_hand_(Flickr).jpg" },
  perro: { title: "Bullmastiff puppy fawn portrait", author: "Joshin Yamada", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/deed.es", page: "https://commons.wikimedia.org/w/index.php?curid=2285556" },
  vaca: { title: "Close-up photograph of a calf's head (Don Det, Laos)", author: "Basile Morin", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.es", page: "https://commons.wikimedia.org/wiki/File:Close-up_photograph_of_a_calf%27s_head_looking_at_the_viewer_with_pricked_ears_in_Don_Det_Laos.jpg" }
};

function renderPhotoCredit(v) {
  const c = PHOTO_CREDITS[v];
  $("#photo-credit").innerHTML = c
    ? `Foto: <a href="${escapeHTML(c.page)}" target="_blank" rel="noopener">«${escapeHTML(c.title)}»</a> de ${escapeHTML(c.author)}, <a href="${escapeHTML(c.licenseUrl)}" target="_blank" rel="noopener">${escapeHTML(c.license)}</a>, vía Wikimedia Commons.`
    : "";
}

function setupAppearance() {
  const el = $("#backdrop-choice");
  const current = document.documentElement.dataset.backdrop || "latas";
  setSegmented(el, current);
  renderPhotoCredit(current);
  bindSegmented(el, v => {
    document.documentElement.dataset.backdrop = v;
    renderPhotoCredit(v);
    try { localStorage.setItem("estudio_mercado_fondo", v); } catch (e) { /* la preferencia es opcional: sin almacenamiento se usa la de siempre */ }
  });
  $("#glass-support").textContent = Glass.supported
    ? "En este navegador el vidrio curva la luz en los bordes (efecto completo)."
    : "En este navegador el vidrio se ve esmerilado. El efecto de curvatura completo funciona en Chrome y Edge.";
}

function setupBackup() {
  setupAppearance();
  $("#backup-btn").addEventListener("click", downloadBackup);
  $("#store-add").addEventListener("submit", async e => {
    e.preventDefault();
    const name = cleanText($("#s-nombre").value);
    if (!name) { $("#s-nombre").focus(); return; }
    if (DB.stores.some(s => fold(s.nombre) === fold(name))) {
      showToast({ title: "Ese comercio ya está en la lista", tone: "info" });
      return;
    }
    await DataStore.saveStores([...DB.stores, { nombre: name, canal: $("#s-canal").value }]);
    $("#s-nombre").value = "";
    afterDataChange();
    renderBackup();
    showToast({ title: "Comercio agregado", message: name });
  });
  $("#sql-download").addEventListener("click", () => {
    download(new Blob([SqlExport.build(DB.records)], { type: "text/plain;charset=utf-8" }), `estudio-mercado-${todayISO()}.sql`);
  });
  $("#sql-copy").addEventListener("click", async () => {
    const text = SqlExport.build(DB.records);
    try {
      await navigator.clipboard.writeText(text);
      showToast({ title: "Script copiado", message: "Pégalo en pgAdmin o psql." });
    } catch (e) {
      showToast({ title: "No se pudo copiar", message: "Usa «Descargar script .sql».", tone: "error" });
    }
  });
  $("#reset-btn").addEventListener("click", async () => {
    const ok = await confirmSheet({
      title: "¿Volver a los datos originales?",
      message: `Se reemplazarán tus ${DB.records.length.toLocaleString("es-CL")} precios por los 342 del estudio original. Los precios agregados después se perderán, a menos que descargues una copia.`,
      confirmLabel: "Volver a los originales",
      destructive: true,
      extraButton: { label: "Descargar copia antes", fn: downloadBackup }
    });
    if (!ok) return;
    const prev = DB.records.map(r => ({ ...r }));
    await DataStore.resetToOriginal();
    afterDataChange();
    renderRoute();
    showToast({
      title: "Datos originales restaurados",
      action: { label: "Deshacer", fn: async () => { await DataStore.replaceAll(prev); afterDataChange(); renderRoute(); showToast({ title: "Datos anteriores recuperados", tone: "info" }); } }
    });
  });
}

/* ==========================================================================
   Inicio de la app
   ========================================================================== */
async function boot() {
  Glass.init();
  // Cualquier error al guardar en la nube se muestra como aviso, en vez de perderse.
  window.addEventListener("unhandledrejection", e => {
    DataStore.saveError = true;
    const msg = (e.reason && e.reason.message) || "Revisa tu conexión a internet.";
    showToast({ title: "No se pudo guardar", message: msg, tone: "error" });
    renderStatus();
  });

  if (Cloud.enabled()) {
    try {
      await Auth.start();
    } catch (err) {
      Auth.show("error", Auth.friendly(err));
      return;
    }
  }
  try {
    await DataStore.init();
  } catch (err) {
    if (Cloud.enabled()) { Auth.show("error", "No se pudieron cargar los datos: " + Auth.friendly(err)); return; }
    throw err;
  }
  if (DataStore.isCloud) {
    // En la nube no se ofrece volver a los datos originales (no se publican en el sitio).
    const reset = document.querySelector(".danger-card");
    if (reset) reset.hidden = true;
    $("#backup-where").textContent = "Tus datos se guardan en la nube y los ves desde cualquier equipo al entrar con tu cuenta. Igual conviene descargar una copia de vez en cuando.";
  }
  refreshFromStore();
  fillDatalists();
  setupHome();
  setupAdd();
  setupList();
  setupImport();
  setupBackup();

  const dlg = $("#sheet");
  $("#sheet-close").addEventListener("click", () => sheet.close());
  // Enter dentro de la hoja guarda (si hay botón Guardar); nunca cierra sin guardar.
  $("#sheet-form").addEventListener("submit", e => {
    e.preventDefault();
    const save = $('#sheet-foot [data-act="save"]');
    if (save) save.click();
  });
  dlg.addEventListener("click", e => { if (e.target === dlg) sheet.close(); });
  dlg.addEventListener("close", () => { if (sheet.onClose) { const f = sheet.onClose; sheet.onClose = null; f(); } });

  window.addEventListener("hashchange", handleRoute);
  let lastW = 0, rt = null;
  new ResizeObserver(entries => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === lastW) return;
    lastW = w;
    clearTimeout(rt);
    rt = setTimeout(() => { if (ui.route === "inicio") renderHome(); }, 120);
  }).observe($("#main"));
  window.addEventListener("scroll", () => Charts.hideTip(), { passive: true });

  if (DataStore.state.meta.migratedFrom === "v2" && !DataStore.state.meta.migrationNoticeShown) {
    showToast({ title: "Tus datos anteriores se conservaron", message: `Se trajeron ${DB.records.length} precios de la versión anterior de la app.`, tone: "info", duration: 10000 });
    DataStore.setMeta({ migrationNoticeShown: true });
  }
  if (DataStore.saveError) {
    showToast({ title: "Este navegador no permite guardar", message: "Los cambios se perderán al cerrar. Descarga una copia antes de salir.", tone: "error" });
  }
  handleRoute();
}

document.addEventListener("DOMContentLoaded", boot);
