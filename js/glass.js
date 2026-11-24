/* Liquid Glass: refracción en los bordes.
   Para cada superficie de vidrio (.card, .glass) se genera un "mapa de desplazamiento"
   con la forma exacta del elemento (rectángulo redondeado). El borde se modela como un
   bisel de vidrio convexo (perfil squircle, índice de refracción 1,5, ley de Snell):
   lo que está detrás se curva cerca del borde, como en una lente gruesa.
   El mapa se aplica con backdrop-filter: url(#filtro) — hoy solo funciona en Chrome/Edge.
   En Safari y Firefox queda el vidrio esmerilado con brillo de borde (CSS). */

const Glass = (() => {
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const supported = brands.some(b => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand));
  const reduceTransparency = matchMedia("(prefers-reduced-transparency: reduce)");

  const N_GLASS = 1.5;      // índice de refracción del vidrio
  const SAMPLES = 128;
  const SELECTOR = ".card, .glass";

  // Perfil de altura del bisel (0 = borde, 1 = zona plana). Squircle convexo, como Apple.
  const height = t => Math.pow(1 - Math.pow(1 - t, 4), 0.25);

  // Magnitud del desplazamiento según la distancia al borde (normalizada a 0..1).
  const MAGS = (() => {
    const out = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / (SAMPLES - 1);
      const d = 0.002;
      const a = Math.max(0, t - d), b = Math.min(1, t + d);
      const slope = (height(b) - height(a)) / (b - a);
      const th1 = Math.atan(slope);                       // ángulo de la normal
      const th2 = Math.asin(Math.sin(th1) / N_GLASS);     // rayo refractado (Snell)
      // desviación del rayo × espesor del vidrio en ese punto
      out.push(Math.tan(th1 - th2) * (0.25 + 0.75 * height(t)));
    }
    const max = Math.max(...out);
    return out.map(v => v / max);
  })();

  let svgDefs = null;
  const filters = new Map();   // clave de tamaño -> id
  const observed = new WeakSet();
  let seq = 0;

  function ensureDefs() {
    if (svgDefs) return svgDefs;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    svg.innerHTML = "<defs></defs>";
    document.body.prepend(svg);
    svgDefs = svg.querySelector("defs");
    return svgDefs;
  }

  /* Mapa de desplazamiento para un rectángulo redondeado w×h, radio r, bisel b. */
  function buildMap(w, h, r, bezel) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(w, h);
    const data = img.data;
    const hw = w / 2, hh = h / 2;
    const rr = Math.min(r, hw, hh);
    for (let y = 0; y < h; y++) {
      const py = y + 0.5 - hh;
      const ay = Math.abs(py);
      const qy = ay - (hh - rr);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i + 2] = 128;
        data[i + 3] = 255;
        const px = x + 0.5 - hw;
        const ax = Math.abs(px);
        const qx = ax - (hw - rr);
        let dist, nx, ny;
        if (qx > 0 && qy > 0) {
          const l = Math.hypot(qx, qy) || 1;
          dist = rr - l; nx = qx / l; ny = qy / l;
        } else if (hw - ax < hh - ay) {
          dist = hw - ax; nx = 1; ny = 0;
        } else {
          dist = hh - ay; nx = 0; ny = 1;
        }
        if (dist <= 0 || dist >= bezel) { data[i] = 128; data[i + 1] = 128; continue; }
        const m = MAGS[Math.round((dist / bezel) * (SAMPLES - 1))];
        // Se toma la imagen desde más adentro (lente convexa): vector hacia el centro.
        const vx = -nx * Math.sign(px) * m;
        const vy = -ny * Math.sign(py) * m;
        data[i] = Math.round(128 + vx * 127);
        data[i + 1] = Math.round(128 + vy * 127);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function filterFor(w, h, r, opts) {
    const key = `${w}x${h}r${r}b${opts.bezel}s${opts.scale}`;
    if (filters.has(key)) return filters.get(key);
    const id = `lg-${++seq}`;
    const href = buildMap(w, h, r, opts.bezel);
    const f = document.createElementNS("http://www.w3.org/2000/svg", "filter");
    f.setAttribute("id", id);
    f.setAttribute("x", "0");
    f.setAttribute("y", "0");
    f.setAttribute("width", String(w));
    f.setAttribute("height", String(h));
    f.setAttribute("filterUnits", "userSpaceOnUse");
    f.setAttribute("color-interpolation-filters", "sRGB");
    f.innerHTML = `
      <feImage href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${opts.scale}" xChannelSelector="R" yChannelSelector="G"/>`;
    ensureDefs().appendChild(f);
    filters.set(key, id);
    // Limpieza: no acumular filtros de tamaños antiguos.
    if (filters.size > 80) {
      const [oldKey, oldId] = filters.entries().next().value;
      filters.delete(oldKey);
      const el = document.getElementById(oldId);
      if (el) el.remove();
    }
    return id;
  }

  function optionsFor(el) {
    const cs = getComputedStyle(el);
    const bezel = parseFloat(cs.getPropertyValue("--glass-bezel")) || 22;
    const scale = parseFloat(cs.getPropertyValue("--glass-refraction")) || 44;
    const blur = cs.getPropertyValue("--glass-frost").trim() || "10px";
    return { bezel, scale, blur, radius: parseFloat(cs.borderTopLeftRadius) || 0 };
  }

  function apply(el) {
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (!w || !h) return;
    const o = optionsFor(el);
    const id = filterFor(w, h, Math.round(o.radius), o);
    const value = `blur(${o.blur}) saturate(1.7) url(#${id})`;
    el.style.backdropFilter = value;
    el.dataset.glassApplied = "1";
  }

  const ro = new ResizeObserver(entries => {
    entries.forEach(e => apply(e.target));
  });

  function scan(root = document) {
    if (!enabled()) return;
    root.querySelectorAll(SELECTOR).forEach(el => {
      if (observed.has(el)) return;
      observed.add(el);
      ro.observe(el);
    });
  }

  function enabled() {
    return supported && !reduceTransparency.matches;
  }

  function init() {
    if (!enabled()) return;
    document.documentElement.classList.add("has-refraction");
    scan();
    let pending = false;
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; scan(); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  return { init, supported };
})();
