/* Capa de datos.
   Toda la app lee y escribe a través de DataStore. Hoy guarda en el navegador
   (localStorage). Para pasar a una base de datos en la nube basta con escribir
   otra versión de este objeto con los mismos métodos. */

const DEFAULT_STORES = [
  { nombre: "Tus mascotas", canal: "Tienda de mascotas" },
  { nombre: "SuperZoo", canal: "Tienda de mascotas" },
  { nombre: "Jumbo", canal: "Supermercado" },
  { nombre: "Tottus", canal: "Supermercado" },
  { nombre: "Lider", canal: "Supermercado" }
];

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function cleanText(v) {
  return String(v == null ? "" : v).trim().replace(/\s+/g, " ");
}

function pricePerKg(precio, peso) {
  return peso > 0 ? Math.round((precio / peso) * 1000 * 100) / 100 : 0;
}

/* Normaliza un registro: limpia espacios y recalcula el precio por kilo. */
function normalizeRecord(r) {
  const peso = Number(r.peso_gr);
  const precio = Number(r.precio);
  return {
    id: r.id != null ? String(r.id) : newId(),
    marca: cleanText(r.marca),
    producto: cleanText(r.producto),
    especie: cleanText(r.especie) || "Gato",
    etapa: cleanText(r.etapa) || "Adulto",
    clasificacion: cleanText(r.clasificacion) || "Alimento completo",
    textura: cleanText(r.textura),
    sabor: cleanText(r.sabor),
    proteina: cleanText(r.proteina),
    peso_gr: peso,
    formato: cleanText(r.formato) || "Lata",
    comercio: cleanText(r.comercio),
    canal: cleanText(r.canal),
    precio: precio,
    fecha: r.fecha || null,
    creado: r.creado || new Date().toISOString(),
    precio_kg: pricePerKg(precio, peso)
  };
}

/* Un mismo precio = mismo producto, mismo comercio y misma fecha. */
function observationKey(r) {
  const low = s => cleanText(s).toLowerCase();
  return [low(r.marca), low(r.producto), Math.round(Number(r.peso_gr) * 100) / 100, low(r.especie), low(r.comercio), r.fecha || ""].join("|");
}

/* Los datos originales se cargan solo cuando hacen falta (modo local o al restaurar),
   para que el sitio en línea no los entregue a quien no ha iniciado sesión. */
function loadSeed() {
  if (typeof SEED_TUPLES !== "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "js/seed.js?v=7";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se encontraron los datos originales del estudio."));
    document.head.appendChild(s);
  });
}

function seedRecords() {
  return SEED_TUPLES.map((t, i) => normalizeRecord({
    id: "s" + (i + 1),
    marca: t[0], producto: t[1], especie: t[2], etapa: t[3], clasificacion: t[4],
    textura: t[5], sabor: t[6], proteina: t[7], peso_gr: t[8], formato: t[9],
    comercio: t[10], canal: t[11], precio: t[12], fecha: null, creado: "2026-01-01T00:00:00.000Z"
  }));
}

const LocalStore = {
  state: { records: [], stores: [], meta: {} },
  saveError: false,

  async init() {
    let loaded = null;
    try {
      const raw = localStorage.getItem(APP_CONFIG.storageKey);
      if (raw) loaded = JSON.parse(raw);
    } catch (e) { loaded = null; }

    if (loaded && Array.isArray(loaded.records)) {
      this.state = {
        records: loaded.records.map(normalizeRecord),
        stores: Array.isArray(loaded.stores) && loaded.stores.length ? loaded.stores : DEFAULT_STORES.slice(),
        meta: loaded.meta || {}
      };
    } else {
      // ¿Hay datos de la versión anterior de la app? Se conservan.
      let legacy = null;
      try {
        const raw = localStorage.getItem(APP_CONFIG.legacyStorageKey);
        if (raw) legacy = JSON.parse(raw);
      } catch (e) { legacy = null; }

      if (Array.isArray(legacy) && legacy.length) {
        this.state = {
          records: legacy.map(r => normalizeRecord({ ...r, id: String(r.id), fecha: null })),
          stores: DEFAULT_STORES.slice(),
          meta: { migratedFrom: "v2", lastChangeAt: new Date().toISOString() }
        };
      } else {
        await loadSeed();
        this.state = { records: seedRecords(), stores: DEFAULT_STORES.slice(), meta: {} };
      }
      this.ensureStoresFromRecords();
      this.persist();
    }
    this.ensureStoresFromRecords();
    return this.snapshot();
  },

  snapshot() {
    return { records: this.state.records, stores: this.state.stores, meta: this.state.meta };
  },

  persist(changed = true) {
    if (changed) this.state.meta.lastChangeAt = new Date().toISOString();
    try {
      localStorage.setItem(APP_CONFIG.storageKey, JSON.stringify(this.state));
      this.saveError = false;
    } catch (e) {
      this.saveError = true;
    }
    return !this.saveError;
  },

  ensureStoresFromRecords() {
    const known = new Set(this.state.stores.map(s => s.nombre.toLowerCase()));
    this.state.records.forEach(r => {
      if (r.comercio && !known.has(r.comercio.toLowerCase())) {
        this.state.stores.push({ nombre: r.comercio, canal: r.canal || "Tienda de mascotas" });
        known.add(r.comercio.toLowerCase());
      }
    });
  },

  /* Inserta o actualiza (si ya existe el mismo precio). Devuelve "inserted" | "updated". */
  _upsertOne(rec) {
    const n = normalizeRecord(rec);
    const key = observationKey(n);
    const idx = this.state.records.findIndex(r => observationKey(r) === key);
    if (idx >= 0) {
      const prev = this.state.records[idx];
      this.state.records[idx] = { ...n, id: prev.id, creado: prev.creado };
      return { mode: "updated", record: this.state.records[idx], previous: prev };
    }
    this.state.records.unshift(n);
    return { mode: "inserted", record: n, previous: null };
  },

  async upsert(rec) {
    const res = this._upsertOne(rec);
    this.ensureStoresFromRecords();
    this.persist();
    return res;
  },

  async upsertMany(list) {
    let inserted = 0, updated = 0;
    list.forEach(r => { this._upsertOne(r).mode === "inserted" ? inserted++ : updated++; });
    this.ensureStoresFromRecords();
    this.persist();
    return { inserted, updated };
  },

  async update(id, patch) {
    const idx = this.state.records.findIndex(r => r.id === id);
    if (idx < 0) return null;
    const prev = this.state.records[idx];
    this.state.records[idx] = normalizeRecord({ ...prev, ...patch, id: prev.id, creado: prev.creado });
    this.ensureStoresFromRecords();
    this.persist();
    return { record: this.state.records[idx], previous: prev };
  },

  async remove(id) {
    const idx = this.state.records.findIndex(r => r.id === id);
    if (idx < 0) return null;
    const [removed] = this.state.records.splice(idx, 1);
    this.persist();
    return { record: removed, index: idx };
  },

  /* Devuelve un registro borrado a su lugar (para "Deshacer"). */
  async restore(record, index = 0) {
    this.state.records.splice(Math.min(index, this.state.records.length), 0, record);
    this.persist();
  },

  /* Revierte una actualización (para "Deshacer"). */
  async revert(previous) {
    const idx = this.state.records.findIndex(r => r.id === previous.id);
    if (idx >= 0) this.state.records[idx] = previous;
    this.persist();
  },

  async replaceAll(list) {
    this.state.records = list.map(r => normalizeRecord({ ...r, id: newId() }));
    this.ensureStoresFromRecords();
    this.persist();
  },

  async resetToOriginal() {
    await loadSeed();
    this.state.records = seedRecords();
    this.ensureStoresFromRecords();
    this.persist();
  },

  async saveStores(stores) {
    this.state.stores = stores;
    this.persist();
  },

  async setMeta(patch) {
    Object.assign(this.state.meta, patch);
    this.persist(false);
  }
};

let DataStore = LocalStore;   // store-supabase.js lo cambia a la nube cuando está configurado
