/* Capa de datos en la nube (Supabase).
   Tiene los mismos métodos que LocalStore (store.js), así el resto de la app no cambia.
   Se activa sola cuando config.js tiene la URL y la clave pública del proyecto. */

const Cloud = {
  client: null,
  user: null,
  enabled() {
    return !!(APP_CONFIG.supabase && APP_CONFIG.supabase.url && APP_CONFIG.supabase.anonKey);
  },
  loadLibrary() {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) return resolve();
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("No se pudo cargar la conexión con la base de datos. Revisa tu internet."));
      document.head.appendChild(s);
    });
  },
  async connect() {
    await this.loadLibrary();
    this.client = window.supabase.createClient(APP_CONFIG.supabase.url, APP_CONFIG.supabase.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return this.client;
  }
};

const PRECIO_FIELDS = ["id", "marca", "producto", "especie", "etapa", "clasificacion", "textura", "sabor", "proteina",
  "peso_gr", "formato", "comercio", "canal", "precio", "fecha"];

function toRow(r) {
  const row = {};
  PRECIO_FIELDS.forEach(f => { row[f] = r[f] === "" ? null : r[f]; });
  return row;
}

function fromRow(row) {
  return normalizeRecord({ ...row, peso_gr: Number(row.peso_gr), precio: Number(row.precio) });
}

async function check(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || "Error de la base de datos");
  return data;
}

const SupabaseStore = {
  state: { records: [], stores: [], meta: {} },
  saveError: false,
  isCloud: true,
  metaKey: APP_CONFIG.storageKey + "_meta",

  get db() { return Cloud.client; },

  async init() {
    let meta = {};
    try { meta = JSON.parse(localStorage.getItem(this.metaKey) || "{}"); } catch (e) { meta = {}; }

    const stores = await check(this.db.from("comercios").select("nombre, canal").order("creado"));
    const rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const page = await check(this.db.from("precios").select("*").order("creado", { ascending: false }).range(from, from + PAGE - 1));
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    this.state = {
      records: rows.map(fromRow),
      stores: stores.length ? stores : DEFAULT_STORES.slice(),
      meta
    };
    return this.snapshot();
  },

  snapshot() {
    return { records: this.state.records, stores: this.state.stores, meta: this.state.meta };
  },

  touch() {
    this.state.meta.lastChangeAt = new Date().toISOString();
    this.saveMeta();
    this.saveError = false;
  },

  saveMeta() {
    try { localStorage.setItem(this.metaKey, JSON.stringify(this.state.meta)); } catch (e) { /* solo recordatorios locales */ }
  },

  /* Antes de guardar precios, el comercio tiene que existir (clave foránea). */
  async ensureStores(records) {
    const known = new Set(this.state.stores.map(s => s.nombre.toLowerCase()));
    const missing = [];
    records.forEach(r => {
      if (r.comercio && !known.has(r.comercio.toLowerCase())) {
        known.add(r.comercio.toLowerCase());
        missing.push({ nombre: r.comercio, canal: r.canal || "Tienda de mascotas" });
      }
    });
    if (missing.length) {
      await check(this.db.from("comercios").upsert(missing, { onConflict: "nombre" }));
      this.state.stores.push(...missing);
    }
  },

  async upsert(rec) {
    const n = normalizeRecord(rec);
    const key = observationKey(n);
    const idx = this.state.records.findIndex(r => observationKey(r) === key);
    await this.ensureStores([n]);
    if (idx >= 0) {
      const prev = this.state.records[idx];
      const row = { ...toRow(n), id: prev.id };
      const data = await check(this.db.from("precios").update(row).eq("id", prev.id).select().single());
      this.state.records[idx] = fromRow(data);
      this.touch();
      return { mode: "updated", record: this.state.records[idx], previous: prev };
    }
    const data = await check(this.db.from("precios").insert(toRow(n)).select().single());
    const saved = fromRow(data);
    this.state.records.unshift(saved);
    this.touch();
    return { mode: "inserted", record: saved, previous: null };
  },

  async upsertMany(list) {
    // Un precio por clave (el último gana), con el id del existente si ya está guardado.
    const byKey = new Map();
    list.map(normalizeRecord).forEach(n => byKey.set(observationKey(n), n));
    const existing = new Map(this.state.records.map(r => [observationKey(r), r]));
    let inserted = 0, updated = 0;
    const rows = [];
    byKey.forEach((n, key) => {
      const prev = existing.get(key);
      if (prev) { updated++; rows.push({ ...toRow(n), id: prev.id }); }
      else { inserted++; rows.push(toRow(n)); }
    });
    await this.ensureStores([...byKey.values()]);
    const saved = [];
    for (let i = 0; i < rows.length; i += 500) {
      const data = await check(this.db.from("precios").upsert(rows.slice(i, i + 500), { onConflict: "id" }).select());
      saved.push(...data.map(fromRow));
    }
    const savedIds = new Set(saved.map(r => r.id));
    this.state.records = [...saved, ...this.state.records.filter(r => !savedIds.has(r.id))];
    this.touch();
    return { inserted, updated };
  },

  async update(id, patch) {
    const idx = this.state.records.findIndex(r => r.id === id);
    if (idx < 0) return null;
    const prev = this.state.records[idx];
    const n = normalizeRecord({ ...prev, ...patch, id: prev.id, creado: prev.creado });
    await this.ensureStores([n]);
    const data = await check(this.db.from("precios").update(toRow(n)).eq("id", id).select().single());
    this.state.records[idx] = fromRow(data);
    this.touch();
    return { record: this.state.records[idx], previous: prev };
  },

  async remove(id) {
    const idx = this.state.records.findIndex(r => r.id === id);
    if (idx < 0) return null;
    await check(this.db.from("precios").delete().eq("id", id));
    const [removed] = this.state.records.splice(idx, 1);
    this.touch();
    return { record: removed, index: idx };
  },

  async restore(record, index = 0) {
    await this.ensureStores([record]);
    const data = await check(this.db.from("precios").insert(toRow(record)).select().single());
    this.state.records.splice(Math.min(index, this.state.records.length), 0, fromRow(data));
    this.touch();
  },

  async revert(previous) {
    const data = await check(this.db.from("precios").update(toRow(previous)).eq("id", previous.id).select().single());
    const idx = this.state.records.findIndex(r => r.id === previous.id);
    if (idx >= 0) this.state.records[idx] = fromRow(data);
    this.touch();
  },

  async replaceAll(list) {
    const fresh = list.map(r => normalizeRecord({ ...r, id: newId() }));
    await this.ensureStores(fresh);
    const byKey = new Map();
    fresh.forEach(n => byKey.set(observationKey(n), n));
    // Una sola transacción en la base: si algo falla, los datos anteriores quedan intactos.
    await check(this.db.rpc("reemplazar_precios", { filas: [...byKey.values()].map(toRow) }));
    // Se vuelve a leer todo porque cada respuesta del servidor trae como máximo 1.000 filas.
    await this.init();
    this.touch();
  },

  async resetToOriginal() {
    await loadSeed();
    await this.replaceAll(seedRecords());
  },

  async saveStores(stores) {
    const keep = new Set(stores.map(s => s.nombre));
    const removed = this.state.stores.filter(s => !keep.has(s.nombre));
    if (stores.length) await check(this.db.from("comercios").upsert(stores.map(s => ({ nombre: s.nombre, canal: s.canal })), { onConflict: "nombre" }));
    for (const s of removed) await check(this.db.from("comercios").delete().eq("nombre", s.nombre));
    this.state.stores = stores;
    this.touch();
  },

  async setMeta(patch) {
    Object.assign(this.state.meta, patch);
    this.saveMeta();
  }
};

if (Cloud.enabled()) DataStore = SupabaseStore;
