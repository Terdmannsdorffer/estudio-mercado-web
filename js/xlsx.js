/* Lectura y escritura mínima de archivos Excel (.xlsx), sin librerías externas.
   Un .xlsx es un ZIP con archivos XML dentro. */

const Xlsx = (() => {
  const td = new TextDecoder("utf-8");
  const te = new TextEncoder();

  /* ---------- ZIP: lectura ---------- */
  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buffer) {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("El archivo no parece ser un Excel (.xlsx) válido.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      files[name] = { method, compSize, localOff };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return {
      has: name => !!files[name],
      async text(name) {
        const f = files[name];
        if (!f) return null;
        const lNameLen = dv.getUint16(f.localOff + 26, true);
        const lExtraLen = dv.getUint16(f.localOff + 28, true);
        const start = f.localOff + 30 + lNameLen + lExtraLen;
        const data = bytes.subarray(start, start + f.compSize);
        const out = f.method === 0 ? data : await inflateRaw(data);
        return td.decode(out);
      }
    };
  }

  /* ---------- XLSX: lectura ---------- */
  function parseXml(text) {
    return new DOMParser().parseFromString(text, "application/xml");
  }
  const byTag = (node, tag) => Array.from(node.getElementsByTagNameNS("*", tag));

  function colIndex(ref) {
    const letters = ref.replace(/\d+/g, "");
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function resolvePath(target) {
    if (target.startsWith("/")) return target.slice(1);
    return "xl/" + target.replace(/^\.\//, "");
  }

  /* Devuelve [{ name, rows: [[valor, ...], ...] }] */
  async function read(buffer) {
    const zip = await unzip(buffer);
    const wbText = await zip.text("xl/workbook.xml");
    if (!wbText) throw new Error("El archivo no contiene una hoja de cálculo.");
    const wb = parseXml(wbText);
    const relsDoc = parseXml((await zip.text("xl/_rels/workbook.xml.rels")) || "<r/>");
    const rels = {};
    byTag(relsDoc, "Relationship").forEach(r => { rels[r.getAttribute("Id")] = r.getAttribute("Target"); });

    let shared = [];
    const ssText = await zip.text("xl/sharedStrings.xml");
    if (ssText) {
      shared = byTag(parseXml(ssText), "si").map(si => byTag(si, "t").map(t => t.textContent).join(""));
    }

    const sheets = [];
    for (const s of byTag(wb, "sheet")) {
      const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const target = rels[rid];
      if (!target) continue;
      const xml = await zip.text(resolvePath(target));
      if (!xml) continue;
      const doc = parseXml(xml);
      const rows = [];
      byTag(doc, "row").forEach(rowEl => {
        const row = [];
        byTag(rowEl, "c").forEach(c => {
          const ref = c.getAttribute("r");
          const t = c.getAttribute("t");
          const vEl = byTag(c, "v")[0];
          let val = "";
          if (t === "s") val = vEl ? (shared[Number(vEl.textContent)] ?? "") : "";
          else if (t === "inlineStr") val = byTag(c, "t").map(x => x.textContent).join("");
          else if (t === "b") val = vEl ? vEl.textContent === "1" : "";
          else if (t === "str" || t === "e") val = vEl ? vEl.textContent : "";
          else val = vEl ? Number(vEl.textContent) : "";
          if (t === "e") val = "";
          row[ref ? colIndex(ref) : row.length] = val;
        });
        for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
        rows.push(row);
      });
      sheets.push({ name: s.getAttribute("name"), rows });
    }
    return sheets;
  }

  /* ---------- ZIP: escritura (sin compresión) ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(entries) {
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;

    entries.forEach(({ name, text }) => {
      const nameBytes = te.encode(name);
      const data = te.encode(text);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    });

    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  /* ---------- XLSX: escritura ---------- */
  function esc(s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function colName(i) {
    let s = "";
    i++;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  /* rows: array de arrays; la primera fila son los encabezados. */
  function write(sheetName, rows, colWidths = []) {
    const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const sheetRows = rows.map((row, r) => {
      const cells = row.map((v, c) => {
        const ref = colName(c) + (r + 1);
        if (v === null || v === undefined || v === "") return "";
        if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${r === 0 ? ' s="1"' : ""}><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    }).join("");
    const cols = colWidths.length
      ? "<cols>" + colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") + "</cols>"
      : "";
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${sheetRows}</sheetData></worksheet>`;

    return zip([
      { name: "[Content_Types].xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: "_rels/.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet ${NS}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
      { name: "xl/worksheets/sheet1.xml", text: sheet }
    ]);
  }

  return { read, write };
})();
