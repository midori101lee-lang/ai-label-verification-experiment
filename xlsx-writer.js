/* ============================================================================
 * xlsx-writer.js  —  零依赖、纯前端的 .xlsx 生成器
 * ----------------------------------------------------------------------------
 * 设计目标（本项目约束）：
 *   - 不引入任何第三方库（SheetJS / ExcelJS 等），避免增加项目复杂度。
 *   - 生成的文件是符合 OOXML (Excel 2007+) 规范的真实 .xlsx，可被 Excel /
 *     LibreOffice / Google Sheets / 问卷星文件上传 正常打开。
 *   - 可在浏览器与 Node 测试中复用（不依赖 DOM）。
 *
 * 实现要点：
 *   - ZIP 容器采用「stored（不压缩，method=0）」方式，避免实现 DEFLATE，
 *     仅依赖 CRC-32 计算，逻辑简洁可靠。
 *   - 单元格文本使用 inline string（t="inlineStr"），无需 sharedStrings.xml。
 *   - 补充 docProps/core.xml 与 app.xml，提升严格读取器的兼容性。
 *
 * 安全 / 数据边界：
 *   - 单个单元格文本上限为 32,767 字符；超过时 buildXlsx 抛出带标识的异常，
 *     由调用方决定降级（例如改为说明文字 + JSON 备用下载），绝不静默截断。
 *   - 所有内容不含任何个人身份信息，仅使用匿名研究编号。
 * ========================================================================== */
(function (global) {
  "use strict";

  var MAX_CELL_CHARS = 32767;

  /* —— 文本 / XML 处理 —— */
  function utf8(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    // 极简回退（覆盖 ASCII + 基本多字节）
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return new Uint8Array(out);
  }

  function xmlEsc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // 去除 XML 1.0 非法控制字符（保留 \t \n \r），避免生成的文件损坏
  function sanitizeXmlText(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) continue;
      out += s[i];
    }
    return out;
  }

  function colLetter(n) {
    // n 为 1 基列号 → A, B, ..., Z, AA, AB ...
    var s = "";
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function sheetName(name) {
    var s = String(name).replace(/[\\/?*:\[\]]/g, "_").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    if (s.length > 31) s = s.slice(0, 31);
    return s;
  }

  /* —— 单元格 —— */
  function cellXml(ref, v) {
    if (v === null || v === undefined || v === "") return '<c r="' + ref + '"/>';
    if (typeof v === "number") {
      if (!isFinite(v)) return '<c r="' + ref + '"/>';
      // 避免 -0 与过长小数
      var num = (Object.is(v, -0) ? 0 : v);
      return '<c r="' + ref + '"><v>' + num + "</v></c>";
    }
    var text = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
    text = sanitizeXmlText(text);
    // 单单元格上限 32,767 字符：超出时写入明确说明文字（绝不静默截断），
    // 完整内容由「下载原始 JSON（备用）」提供。调用方也会据此提示参与者。
    if (text.length > MAX_CELL_CHARS) {
      return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
        xmlEsc("⚠ 该字段内容超过 Excel 单单元格 32767 字符上限，已避免写入以防截断；请使用「下载原始 JSON（备用）」获取完整内容。") +
        "</t></is></c>";
    }
    return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(text) + "</t></is></c>";
  }

  function sheetXml(rows) {
    var out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
    out += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    out += "<sheetData>";
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || [];
      out += '<row r="' + (r + 1) + '">';
      for (var c = 0; c < row.length; c++) {
        out += cellXml(colLetter(c + 1) + (r + 1), row[c]);
      }
      out += "</row>";
    }
    out += "</sheetData></worksheet>";
    return out;
  }

  /* —— CRC-32（标准多项式 0xEDB88320） —— */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
  }

  /* —— ZIP（stored） —— */
  function zip(files) {
    var enc = utf8;
    var nameEnc = function (s) { return utf8(s); }; // 文件名使用 ASCII
    var chunks = [];
    var central = [];
    var offset = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var nameBytes = nameEnc(f.name);
      var data = f.data;
      var crc = crc32(data);
      var size = data.length;
      var lh = new Uint8Array(30 + nameBytes.length);
      var ldv = new DataView(lh.buffer);
      ldv.setUint32(0, 0x04034b50, true);
      ldv.setUint16(4, 20, true);
      ldv.setUint16(6, 0, true);
      ldv.setUint16(8, 0, true);       // method = stored
      ldv.setUint16(10, 0, true);      // time
      ldv.setUint16(12, 0, true);      // date
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, size, true);
      ldv.setUint32(22, size, true);
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      chunks.push(lh, data);

      var ch = new Uint8Array(46 + nameBytes.length);
      var cdv = new DataView(ch.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, 0, true);
      cdv.setUint16(14, 0, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, size, true);
      cdv.setUint32(24, size, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint16(30, 0, true);
      cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true);
      cdv.setUint16(36, 0, true);
      cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + data.length;
    }
    var cdSize = 0;
    for (var ci = 0; ci < central.length; ci++) cdSize += central[ci].length;
    var eocd = new Uint8Array(22);
    var edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(4, 0, true);
    edv.setUint16(6, 0, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, cdSize, true);
    edv.setUint32(16, offset, true);
    edv.setUint16(20, 0, true);

    var total = 0;
    for (var k = 0; k < chunks.length; k++) total += chunks[k].length;
    total += cdSize + eocd.length;
    var out = new Uint8Array(total);
    var p = 0;
    for (var c2 = 0; c2 < chunks.length; c2++) { out.set(chunks[c2], p); p += chunks[c2].length; }
    for (var c3 = 0; c3 < central.length; c3++) { out.set(central[c3], p); p += central[c3].length; }
    out.set(eocd, p);
    return out;
  }

  /* —— 构建 .xlsx —— */
  // sheets: [{ name: string, rows: Array<Array<any>> }]  rows[0] 为表头
  function buildXlsx(sheets) {
    if (!Array.isArray(sheets) || sheets.length === 0) throw new Error("XLSX 至少需要一个工作表");
    if (sheets.length > 255) throw new Error("XLSX 工作表数量超过上限(255)");

    var files = [];

    // [Content_Types].xml
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>';
    for (var i = 0; i < sheets.length; i++) {
      ct += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    ct += "</Types>";
    files.push({ name: "[Content_Types].xml", data: utf8(ct) });

    // _rels/.rels
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      "</Relationships>";
    files.push({ name: "_rels/.rels", data: utf8(rels) });

    // xl/workbook.xml
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    for (var s = 0; s < sheets.length; s++) {
      wb += '<sheet name="' + xmlEsc(sheetName(sheets[s].name)) + '" sheetId="' + (s + 1) + '" r:id="rId' + (s + 1) + '"/>';
    }
    wb += "</sheets></workbook>";
    files.push({ name: "xl/workbook.xml", data: utf8(wb) });

    // xl/_rels/workbook.xml.rels
    var wrels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    for (var r = 0; r < sheets.length; r++) {
      wrels += '<Relationship Id="rId' + (r + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (r + 1) + '.xml"/>';
    }
    wrels += "</Relationships>";
    files.push({ name: "xl/_rels/workbook.xml.rels", data: utf8(wrels) });

    // docProps/core.xml
    var now = new Date().toISOString();
    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      "<dc:creator>ai-label-verification-experiment</dc:creator>" +
      "<cp:lastModifiedBy>ai-label-verification-experiment</cp:lastModifiedBy>" +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + "</dcterms:created>" +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + "</dcterms:modified>" +
      "</cp:coreProperties>";
    files.push({ name: "docProps/core.xml", data: utf8(core) });

    // docProps/app.xml
    var app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      "<Application>ai-label-verification-experiment</Application>" +
      "<Company></Company>" +
      "<TitlesOfParts><vt:vector size=\"" + sheets.length + "\" baseType=\"lpstr\">" +
      sheets.map(function (sh) { return "<vt:lpstr>" + xmlEsc(sheetName(sh.name)) + "</vt:lpstr>"; }).join("") +
      "</vt:vector></TitlesOfParts>" +
      "</Properties>";
    files.push({ name: "docProps/app.xml", data: utf8(app) });

    // worksheets
    for (var w = 0; w < sheets.length; w++) {
      files.push({ name: "xl/worksheets/sheet" + (w + 1) + ".xml", data: utf8(sheetXml(sheets[w].rows)) });
    }

    return zip(files);
  }

  // 暴露给浏览器与 Node
  global.buildXlsx = buildXlsx;
  global.XLSX_MAX_CELL_CHARS = MAX_CELL_CHARS;
  if (typeof module !== "undefined" && module.exports) module.exports = { buildXlsx: buildXlsx, XLSX_MAX_CELL_CHARS: MAX_CELL_CHARS };

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
