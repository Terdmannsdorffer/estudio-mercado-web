/* Gráficos SVG. Los colores salen de variables CSS (modo claro y oscuro). */

const Charts = (() => {
  const tipEl = () => document.getElementById("tooltip");

  function showTip(html, x, y) {
    const t = tipEl();
    t.innerHTML = html;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 12) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 12) top = y - r.height - 14;
    t.style.left = Math.max(12, left) + "px";
    t.style.top = Math.max(12, top) + "px";
  }
  function hideTip() { const t = tipEl(); if (t) t.hidden = true; }

  const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function niceMax(v) {
    if (v <= 0) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / exp;
    const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * exp;
  }

  function barPath(x, y, w, h, r) {
    if (h <= 0 || w <= 0) return "";
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${y + h}Z`;
  }
  function hbarPath(x, y, w, h, r) {
    if (h <= 0 || w <= 0) return "";
    r = Math.min(r, h / 2, w);
    return `M${x},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}L${x},${y + h}Z`;
  }

  /* Conecta tooltips a los elementos con data-tip="índice". */
  function bindTips(el, tips) {
    const svg = el.querySelector("svg");
    if (!svg) return;
    const handler = e => {
      const target = e.target.closest("[data-tip]");
      if (!target) { hideTip(); return; }
      svg.querySelectorAll(".is-hover").forEach(n => n.classList.remove("is-hover"));
      target.classList.add("is-hover");
      showTip(tips[Number(target.dataset.tip)], e.clientX, e.clientY);
    };
    svg.addEventListener("pointermove", handler);
    svg.addEventListener("pointerdown", handler);
    svg.addEventListener("pointerleave", () => {
      svg.querySelectorAll(".is-hover").forEach(n => n.classList.remove("is-hover"));
      hideTip();
    });
  }

  function empty(el, msg = "No hay datos para este filtro.") {
    el.innerHTML = `<div class="chart-empty">${esc(msg)}</div>`;
  }

  /* Barras agrupadas verticales. */
  function groupedBars(el, cfg) {
    const width = Math.max(300, el.clientWidth);
    const height = cfg.height || 260;
    const pad = { top: 26, right: 8, bottom: 34, left: 52 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const all = [];
    cfg.categories.forEach(c => cfg.series.forEach(s => all.push(cfg.value(c.key, s.key).value)));
    if (!all.some(v => v > 0)) return empty(el);
    const max = niceMax(Math.max(...all) * 1.08);
    const ticks = 4;
    const y = v => pad.top + plotH - (v / max) * plotH;
    const tips = [];
    let out = `<svg width="${width}" height="${height}" role="img" aria-label="${esc(cfg.ariaLabel)}">`;
    for (let i = 0; i <= ticks; i++) {
      const v = (max / ticks) * i;
      out += `<line class="grid${i === 0 ? " baseline" : ""}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(v)}" y2="${y(v)}"/>`;
      out += `<text class="axis" x="${pad.left - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${esc(cfg.tick(v))}</text>`;
    }
    const groupW = plotW / cfg.categories.length;
    const gap = 2;
    const barW = Math.min(34, (groupW * 0.62 - gap * (cfg.series.length - 1)) / cfg.series.length);
    const groupInner = barW * cfg.series.length + gap * (cfg.series.length - 1);
    cfg.categories.forEach((c, ci) => {
      const gx = pad.left + groupW * ci + (groupW - groupInner) / 2;
      cfg.series.forEach((s, si) => {
        const d = cfg.value(c.key, s.key);
        const x = gx + si * (barW + gap);
        if (d.value > 0) {
          const top = y(d.value);
          tips.push(`<strong>${esc(s.name)} · ${esc(c.label)}</strong><br>${esc(cfg.format(d.value))} por kg<br><span class="tip-muted">${d.n} producto${d.n === 1 ? "" : "s"}</span>`);
          out += `<path class="mark ${s.cls}" d="${barPath(x, top, barW, pad.top + plotH - top, 4)}" data-tip="${tips.length - 1}"/>`;
          if (barW >= 22) out += `<text class="value" x="${x + barW / 2}" y="${top - 7}" text-anchor="middle">${esc(cfg.short(d.value))}</text>`;
        }
      });
      out += `<text class="axis axis-cat" x="${pad.left + groupW * ci + groupW / 2}" y="${height - 12}" text-anchor="middle">${esc(c.label)}</text>`;
    });
    out += "</svg>";
    el.innerHTML = out;
    bindTips(el, tips);
  }

  /* Filas con rango (P25–P75) y marcador de mediana. */
  function rangeRows(el, cfg) {
    const rows = cfg.rows.filter(r => r.n > 0);
    if (!rows.length) return empty(el);
    const width = Math.max(300, el.clientWidth);
    const rowH = 44;
    const labelW = Math.min(150, width * 0.32);
    const valueW = 78;
    const pad = { top: 6, bottom: 28 };
    const height = pad.top + rowH * rows.length + pad.bottom;
    const x0 = labelW + 8, x1 = width - valueW;
    const max = niceMax(Math.max(...rows.map(r => r.p75)) * 1.05);
    const x = v => x0 + (v / max) * (x1 - x0);
    const tips = [];
    let out = `<svg width="${width}" height="${height}" role="img" aria-label="${esc(cfg.ariaLabel)}">`;
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      out += `<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${pad.top}" y2="${height - pad.bottom}"/>`;
      out += `<text class="axis" x="${x(v)}" y="${height - 8}" text-anchor="middle">${esc(cfg.tick(v))}</text>`;
    }
    rows.forEach((r, i) => {
      const cy = pad.top + rowH * i + rowH / 2;
      tips.push(`<strong>${esc(r.label)}</strong><br>Precio típico: ${esc(cfg.format(r.median))} por kg<br>La mayoría entre ${esc(cfg.format(r.p25))} y ${esc(cfg.format(r.p75))}<br><span class="tip-muted">${r.n} producto${r.n === 1 ? "" : "s"}</span>`);
      out += `<g data-tip="${tips.length - 1}" class="hit">`;
      out += `<rect class="hit-area" x="0" y="${cy - rowH / 2}" width="${width}" height="${rowH}"/>`;
      out += `<text class="label" x="0" y="${cy - 6}" dominant-baseline="middle">${esc(r.label)}</text>`;
      out += `<text class="axis" x="0" y="${cy + 11}" dominant-baseline="middle">${r.n} productos</text>`;
      const rx = x(r.p25), rw = Math.max(6, x(r.p75) - x(r.p25));
      out += `<rect class="range" x="${rx}" y="${cy - 6}" width="${rw}" height="12" rx="6"/>`;
      out += `<circle class="median" cx="${x(r.median)}" cy="${cy}" r="6.5"/>`;
      out += `<text class="value" x="${width}" y="${cy}" text-anchor="end" dominant-baseline="middle">${esc(cfg.format(r.median))}</text>`;
      out += `</g>`;
    });
    out += "</svg>";
    el.innerHTML = out;
    bindTips(el, tips);
  }

  /* Barras horizontales simples. */
  function hbars(el, cfg) {
    const rows = cfg.rows;
    if (!rows.length) return empty(el);
    const width = Math.max(300, el.clientWidth);
    const rowH = 34;
    const labelW = Math.min(110, width * 0.28);
    const valueW = 120;
    const height = rowH * rows.length + 4;
    const x0 = labelW + 8, x1 = width - valueW;
    const max = Math.max(...rows.map(r => r.value));
    const tips = [];
    let out = `<svg width="${width}" height="${height}" role="img" aria-label="${esc(cfg.ariaLabel)}">`;
    rows.forEach((r, i) => {
      const cy = rowH * i + rowH / 2;
      const w = Math.max(2, ((r.value / max) * (x1 - x0)));
      tips.push(`<strong>${esc(r.label)}</strong><br>Precio típico: ${esc(cfg.format(r.value))} por kg<br><span class="tip-muted">${r.n} productos</span>`);
      out += `<g data-tip="${tips.length - 1}" class="hit">`;
      out += `<rect class="hit-area" x="0" y="${cy - rowH / 2}" width="${width}" height="${rowH}"/>`;
      out += `<text class="label" x="${labelW}" y="${cy}" text-anchor="end" dominant-baseline="middle">${esc(r.label)}</text>`;
      out += `<path class="mark s-single" d="${hbarPath(x0, cy - 7, w, 14, 4)}"/>`;
      out += `<text class="value" x="${x0 + w + 8}" y="${cy}" dominant-baseline="middle">${esc(cfg.format(r.value))} <tspan class="axis">· ${r.n}</tspan></text>`;
      out += `</g>`;
    });
    out += "</svg>";
    el.innerHTML = out;
    bindTips(el, tips);
  }

  /* Dispersión: peso (x) vs precio por kg (y). */
  function scatter(el, cfg) {
    const pts = cfg.points;
    if (!pts.length) return empty(el);
    const width = Math.max(300, el.clientWidth);
    const height = cfg.height || 300;
    const pad = { top: 14, right: 14, bottom: 34, left: 52 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const maxX = niceMax(Math.max(...pts.map(p => p.x)) * 1.04);
    const maxY = niceMax(Math.max(...pts.map(p => p.y)) * 1.04);
    const X = v => pad.left + (v / maxX) * plotW;
    const Y = v => pad.top + plotH - (v / maxY) * plotH;
    let out = `<svg width="${width}" height="${height}" role="img" aria-label="${esc(cfg.ariaLabel)}">`;
    for (let i = 0; i <= 4; i++) {
      const v = (maxY / 4) * i;
      out += `<line class="grid${i === 0 ? " baseline" : ""}" x1="${pad.left}" x2="${width - pad.right}" y1="${Y(v)}" y2="${Y(v)}"/>`;
      out += `<text class="axis" x="${pad.left - 8}" y="${Y(v)}" text-anchor="end" dominant-baseline="middle">${esc(cfg.yTick(v))}</text>`;
    }
    for (let i = 0; i <= 4; i++) {
      const v = (maxX / 4) * i;
      out += `<text class="axis" x="${X(v)}" y="${height - 12}" text-anchor="middle">${esc(cfg.xTick(v))}</text>`;
    }
    pts.forEach((p, i) => {
      out += `<circle class="dot ${p.cls}" cx="${X(p.x)}" cy="${Y(p.y)}" r="4" data-i="${i}"/>`;
    });
    out += `<circle class="dot-focus" r="7" cx="-20" cy="-20"/>`;
    out += "</svg>";
    el.innerHTML = out;

    const svg = el.querySelector("svg");
    const focus = svg.querySelector(".dot-focus");
    const coords = pts.map(p => [X(p.x), Y(p.y)]);
    const move = e => {
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = -1, bestD = e.pointerType === "touch" ? 24 : 16;
      coords.forEach(([cx, cy], i) => {
        const d = Math.hypot(mx - cx, my - cy);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best < 0) { hideTip(); focus.setAttribute("cx", -20); return; }
      focus.setAttribute("cx", coords[best][0]);
      focus.setAttribute("cy", coords[best][1]);
      showTip(cfg.tip(pts[best].item), e.clientX, e.clientY);
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointerleave", () => { hideTip(); focus.setAttribute("cx", -20); });
  }

  return { groupedBars, rangeRows, hbars, scatter, hideTip };
})();
