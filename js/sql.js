/* Genera un script PostgreSQL (16+) completo: esquema en 3FN, procedimiento de
   carga idempotente y una llamada por cada precio. Se puede ejecutar varias veces
   sin duplicar datos. */

const SqlExport = (() => {
  const q = v => (v === null || v === undefined || v === "") ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
  const n = v => (Number.isFinite(Number(v)) ? String(Number(v)) : "NULL");

  const SCHEMA = `-- ============================================================
-- Estudio de Mercado · Alimento húmedo para mascotas (Chile, CLP)
-- Esquema relacional en tercera forma normal (3FN) para PostgreSQL 16+
-- ============================================================
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS marcas (
    marca_id  SERIAL PRIMARY KEY,
    nombre    CITEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS comercios (
    comercio_id  SERIAL PRIMARY KEY,
    nombre       CITEXT NOT NULL UNIQUE,
    canal        VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS productos_sku (
    sku_id         BIGSERIAL PRIMARY KEY,
    marca_id       INT NOT NULL REFERENCES marcas(marca_id),
    nombre         CITEXT NOT NULL,
    especie        VARCHAR(20) NOT NULL CHECK (especie IN ('Gato', 'Perro', 'Perro y gato')),
    etapa_vida     VARCHAR(40) NOT NULL,
    clasificacion  VARCHAR(40) NOT NULL,
    textura        VARCHAR(40),
    sabor          VARCHAR(160),
    proteina       VARCHAR(60),
    peso_neto_gr   NUMERIC(8,2) NOT NULL CHECK (peso_neto_gr > 0),
    formato        VARCHAR(20) NOT NULL,
    UNIQUE (marca_id, nombre, especie, peso_neto_gr)
);

-- fecha_levantamiento NULL = precio del estudio inicial (fecha no registrada).
CREATE TABLE IF NOT EXISTS observaciones_precios (
    observacion_id       BIGSERIAL PRIMARY KEY,
    sku_id               BIGINT NOT NULL REFERENCES productos_sku(sku_id) ON DELETE CASCADE,
    comercio_id          INT NOT NULL REFERENCES comercios(comercio_id),
    fecha_levantamiento  DATE,
    precio_clp           NUMERIC(12,2) NOT NULL CHECK (precio_clp > 0),
    peso_neto_gr_snap    NUMERIC(8,2) NOT NULL CHECK (peso_neto_gr_snap > 0),
    precio_por_kg_clp    NUMERIC(12,2) GENERATED ALWAYS AS (
        ROUND(precio_clp / peso_neto_gr_snap * 1000.0, 2)
    ) STORED,
    CONSTRAINT observacion_unica UNIQUE NULLS NOT DISTINCT (sku_id, comercio_id, fecha_levantamiento)
);

CREATE INDEX IF NOT EXISTS idx_obs_comercio ON observaciones_precios (comercio_id);
CREATE INDEX IF NOT EXISTS idx_sku_especie_clasif ON productos_sku (especie, clasificacion);

-- Carga idempotente de un precio: crea o actualiza marca, comercio, producto y observación.
CREATE OR REPLACE PROCEDURE sp_ingestar_registro_mercado(
    p_marca          TEXT,
    p_producto       TEXT,
    p_especie        TEXT,
    p_etapa          TEXT,
    p_clasificacion  TEXT,
    p_textura        TEXT,
    p_sabor          TEXT,
    p_proteina       TEXT,
    p_peso_gr        NUMERIC,
    p_formato        TEXT,
    p_comercio       TEXT,
    p_canal          TEXT,
    p_precio_clp     NUMERIC,
    p_fecha          DATE DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_marca_id     INT;
    v_comercio_id  INT;
    v_sku_id       BIGINT;
BEGIN
    INSERT INTO marcas (nombre)
    VALUES (BTRIM(p_marca))
    ON CONFLICT (nombre) DO UPDATE SET nombre = marcas.nombre
    RETURNING marca_id INTO v_marca_id;

    INSERT INTO comercios (nombre, canal)
    VALUES (BTRIM(p_comercio), COALESCE(NULLIF(BTRIM(p_canal), ''), 'Tienda de mascotas'))
    ON CONFLICT (nombre) DO UPDATE SET canal = EXCLUDED.canal
    RETURNING comercio_id INTO v_comercio_id;

    INSERT INTO productos_sku (marca_id, nombre, especie, etapa_vida, clasificacion,
                               textura, sabor, proteina, peso_neto_gr, formato)
    VALUES (v_marca_id, BTRIM(p_producto), p_especie, p_etapa, p_clasificacion,
            NULLIF(BTRIM(p_textura), ''), NULLIF(BTRIM(p_sabor), ''), NULLIF(BTRIM(p_proteina), ''),
            p_peso_gr, p_formato)
    ON CONFLICT (marca_id, nombre, especie, peso_neto_gr) DO UPDATE SET
        etapa_vida    = EXCLUDED.etapa_vida,
        clasificacion = EXCLUDED.clasificacion,
        textura       = EXCLUDED.textura,
        sabor         = EXCLUDED.sabor,
        proteina      = EXCLUDED.proteina,
        formato       = EXCLUDED.formato
    RETURNING sku_id INTO v_sku_id;

    INSERT INTO observaciones_precios (sku_id, comercio_id, fecha_levantamiento, precio_clp, peso_neto_gr_snap)
    VALUES (v_sku_id, v_comercio_id, p_fecha, p_precio_clp, p_peso_gr)
    ON CONFLICT ON CONSTRAINT observacion_unica DO UPDATE SET
        precio_clp        = EXCLUDED.precio_clp,
        peso_neto_gr_snap = EXCLUDED.peso_neto_gr_snap;
END;
$$;

-- Vista plana para consultar y exportar.
CREATE OR REPLACE VIEW v_precios AS
SELECT o.observacion_id,
       m.nombre  AS marca,
       p.nombre  AS producto,
       p.especie, p.etapa_vida, p.clasificacion, p.textura, p.sabor, p.proteina,
       p.peso_neto_gr, p.formato,
       c.nombre  AS comercio,
       c.canal,
       o.fecha_levantamiento,
       o.precio_clp,
       o.precio_por_kg_clp
FROM observaciones_precios o
JOIN productos_sku p ON p.sku_id = o.sku_id
JOIN marcas m        ON m.marca_id = p.marca_id
JOIN comercios c     ON c.comercio_id = o.comercio_id;
`;

  function build(records) {
    const calls = records.map(r =>
      `CALL sp_ingestar_registro_mercado(${q(r.marca)}, ${q(r.producto)}, ${q(r.especie)}, ${q(r.etapa)}, ${q(r.clasificacion)}, ${q(r.textura)}, ${q(r.sabor)}, ${q(r.proteina)}, ${n(r.peso_gr)}, ${q(r.formato)}, ${q(r.comercio)}, ${q(r.canal)}, ${n(r.precio)}, ${r.fecha ? q(r.fecha) + "::date" : "NULL"});`
    ).join("\n");
    const stamp = new Date().toISOString().slice(0, 10);
    return `-- Generado por la app Estudio de Mercado el ${stamp} · ${records.length} precios\nBEGIN;\n\n${SCHEMA}\n-- ============================================================\n-- Datos\n-- ============================================================\n${calls}\n\nCOMMIT;\n`;
  }

  return { build };
})();
