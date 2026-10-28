// 自动化测试：实验记录 → XLSX（三工作表）生成与解析校验。
// 在 Node 沙箱中加载 xlsx-writer.js 与 index.html 主脚本，
// 真实调用 recordsToXlsxSheets() + buildXlsx() 生成 .xlsx，
// 再手工解析 ZIP（stored 方式）验证三个工作表、事件日志、原始 JSON、超长处理与编号一致性。
//
// 注意：本测试不启动真实浏览器，UI 点击交互未在浏览器中实测（见报告）。

import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "index.html");
const writerPath = path.join(root, "xlsx-writer.js");

const noop = () => {};
const fakeEl = () => ({
  style: {}, dataset: {}, children: [], classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  set innerHTML(v) {}, get innerHTML() { return ""; }, textContent: "",
  addEventListener: noop, removeEventListener: noop, appendChild: noop, insertBefore: noop,
  setAttribute: noop, removeAttribute: noop, hasAttribute: () => false, querySelector: () => null,
  querySelectorAll: () => [], remove: noop, value: "", parentNode: { insertBefore: noop }
});
const documentStub = {
  addEventListener: noop, removeEventListener: noop,
  querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => null, createElement: fakeEl, body: fakeEl()
};
const localStorageStub = (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
})();

const sandbox = {
  document: documentStub,
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  performance: { now: () => 1000 },
  localStorage: localStorageStub,
  console, setTimeout,
  fetch: () => Promise.reject(new Error("no network")),
  encodeURIComponent, decodeURIComponent, Math, JSON, Date, Promise, Object, Array, String, Number, Boolean,
  Uint8Array, DataView, TextEncoder, RegExp, isFinite, parseInt, parseFloat
};
sandbox.window = sandbox;          // 让 xlsx-writer.js 的 IIFE 与 globalThis 指向同一对象
sandbox.globalThis = sandbox;
sandbox.addEventListener = noop;
sandbox.scrollTo = noop;
sandbox.location = { href: "" };

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

// —— 加载 xlsx-writer.js —— //
const writerCode = fs.readFileSync(writerPath, "utf8");
vm.runInContext(writerCode, vm.createContext(sandbox), { filename: "xlsx-writer.js" });
const buildXlsx = sandbox.buildXlsx || sandbox.window.buildXlsx;
check("xlsx-writer.js 已暴露 buildXlsx", typeof buildXlsx === "function");

// —— 加载 index.html 主脚本 —— //
const html = fs.readFileSync(htmlPath, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("未找到主 <script> 块"); process.exit(1); }
const codeExport = m[1] + "\n;globalThis.__T = { recordsToXlsxSheets, deriveVerifyStatus };";
try {
  vm.runInContext(codeExport, sandbox, { filename: "index.html#script" });
} catch (e) {
  console.error("index.html 脚本语法/运行错误：", e.message);
  process.exit(1);
}
const { recordsToXlsxSheets, deriveVerifyStatus } = sandbox.__T;
check("recordsToXlsxSheets 已暴露", typeof recordsToXlsxSheets === "function");

// —— 构造样本记录 —— //
function makeRec(pid, opts = {}) {
  const ai = opts.ai ?? 1, ec = opts.ec ?? 0;
  return {
    schema_version: "exp-v2", participant_id: pid,
    AI_label: ai, evidence_consistency: ec,
    news_version: "AI_label=" + ai + " · evidence_consistency=" + ec,
    consent_given: true, consent_ts: 1700000000000,
    status: opts.status || "completed", step: opts.step || 4,
    started_at: 1700000000000, last_active: 1700000100000, completed_at: opts.completed_at || 1700000095000,
    reading_time_sec: 40, completion_time_sec: 95,
    server_synced: false, server_received_at: null,
    verify: opts.verify || {
      reached: true, declined: false, opened_any: true, count: 2,
      types: ["A 查看原始实验数据", "B 查看研究机构说明"],
      order: ["A 查看原始实验数据", "B 查看研究机构说明"],
      open: { raw: true, inst: true, media: false, fact: false },
      dwell: { raw: 12.3, inst: 8.1 }, time: [{ type: "raw", sec: 12.3 }, { type: "inst", sec: 8.1 }],
      events: [
        { key: "raw", type: "A 查看原始实验数据", action: "open", ts: 1700000010000 },
        { key: "raw", type: "A 查看原始实验数据", action: "close", ts: 1700000020000 },
        { key: "inst", type: "B 查看研究机构说明", action: "open", ts: 1700000030000 },
        { key: null, type: "（暂不查看其他材料）", action: "decline", ts: 1700000040000 }
      ]
    }
  };
}

const recOpened = makeRec("EXP-ONE11111");
const recDeclined = makeRec("EXP-TWO22222", { verify: { reached: true, declined: true, opened_any: false, count: 0, types: [], order: [], open: {}, dwell: {}, time: [], events: [{ key: null, type: "（暂不查看其他材料）", action: "decline", ts: 1700000040000 }] } });
const recSkipped = makeRec("EXP-THR33333", { verify: { reached: true, declined: false, opened_any: false, count: 0, types: [], order: [], open: {}, dwell: {}, time: [], events: [] } });
const recInProgress = makeRec("EXP-FOU44444", { status: "in_progress", completed_at: undefined, step: 3, verify: { reached: false, declined: false, opened_any: false, count: 0, types: [], order: [], open: {}, dwell: {}, time: [], events: [] } });
// 超长原始 JSON：注入一个远超 32767 字符的字段，使 raw_json 单元格超限（触发降级说明文字）
const recHuge = makeRec("EXP-FIV55555");
recHuge.__huge = "x".repeat(40000); // 进入 JSON.stringify(raw_json) 序列化体

// —— 解析 stored-ZIP —— //
function parseXlsx(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let i = 0;
  while (i + 4 <= bytes.length) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      let o = i + 4 + 10; // 跳过 sig(4)+ver/flag/method/time/date(10)
      o += 4; const comp = dv.getUint32(o, true); o += 4;
      o += 4; // uncomp
      const nameLen = dv.getUint16(o, true); o += 2;
      const extraLen = dv.getUint16(o, true); o += 2;
      const name = new TextDecoder().decode(bytes.slice(o, o + nameLen)); o += nameLen + extraLen;
      const data = bytes.slice(o, o + comp); o += comp;
      files[name] = new TextDecoder("utf-8").decode(data);
      i = o;
    } else i++;
  }
  return files;
}

function parseSheetRows(xml) {
  // 返回二维数组；单元格：inlineStr 取 <t> 文本（去转义），数值取 <v>，空单元格为空串
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rowXml = rm[1];
    const cells = [];
    const cellRe = /<c[^>]*?(?:\/>|>(?:<\/c>)?([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rowXml))) {
      const inner = cm[1] || "";
      if (inner.indexOf('t="inlineStr"') >= 0 || inner.indexOf("<is>") >= 0) {
        const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        cells.push(t ? unescapeXml(t[1]) : "");
      } else if (inner.indexOf("<v>") >= 0) {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        cells.push(v ? v[1] : "");
      } else {
        cells.push("");
      }
    }
    rows.push(cells);
  }
  return rows;
}
function unescapeXml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}
function sheetNamesFromWorkbook(xml) {
  const names = [];
  const re = /<sheet name="([^"]+)"[^>]*r:id="rId(\d+)"/g;
  let mm;
  while ((mm = re.exec(xml))) names[parseInt(mm[2], 10) - 1] = unescapeXml(mm[1]);
  return names;
}

console.log("【1】单记录 XLSX 生成与结构");
let sheets, bytes, files;
try {
  sheets = recordsToXlsxSheets([recOpened]);
  bytes = buildXlsx(sheets);
  files = parseXlsx(bytes);
  check("buildXlsx 返回 Uint8Array", bytes instanceof Uint8Array);
  check("含 [Content_Types].xml", !!files["[Content_Types].xml"]);
  check("含 xl/workbook.xml", !!files["xl/workbook.xml"]);
  check("含 3 个工作表 xml", !!files["xl/worksheets/sheet1.xml"] && !!files["xl/worksheets/sheet2.xml"] && !!files["xl/worksheets/sheet3.xml"]);
} catch (e) {
  console.error("生成失败：", e.message); fail++; 
}

const names = sheetNamesFromWorkbook(files["xl/workbook.xml"] || "");
check("工作表顺序为 participant_summary / event_log / raw_json", names[0] === "participant_summary" && names[1] === "event_log" && names[2] === "raw_json");

console.log("【2】participant_summary 字段与编号");
const sumRows = parseSheetRows(files["xl/worksheets/sheet1.xml"] || "");
check("participant_summary 表头含 participant_id", (sumRows[0] || []).includes("participant_id"));
check("participant_summary 表头含 verify_status / verification / verify_count / verify_order", ["verify_status", "verification", "verify_count", "verify_order"].every(c => (sumRows[0] || []).includes(c)));
check("participant_summary 数据行 = 1（单记录）", sumRows.length === 2);
const sumPidIdx = (sumRows[0] || []).indexOf("participant_id");
const sumStatusIdx = (sumRows[0] || []).indexOf("verify_status");
check("汇总行 participant_id = EXP-ONE11111", sumRows[1] && sumRows[1][sumPidIdx] === "EXP-ONE11111");
check("汇总行 verify_status = opened（至少打开1份）", sumRows[1] && sumRows[1][sumStatusIdx] === "opened");

console.log("【3】event_log 保留全部事件（含重复打开 / 关闭 / 拒绝）");
const evRows = parseSheetRows(files["xl/worksheets/sheet2.xml"] || "");
check("event_log 表头正确", (evRows[0] || []).join(",") === "participant_id,event_seq,material_key,material_label,action,ts_epoch_ms,ts_iso");
check("event_log 数据行 = 4（open/close/open/decline，未合并）", evRows.length === 5);
const actions = evRows.slice(1).map(r => r[4]);
check("event_log 含 open/close/decline 三种动作", actions.includes("open") && actions.includes("close") && actions.includes("decline"));
check("event_log 每行 participant_id 一致", evRows.slice(1).every(r => r[0] === "EXP-ONE11111"));

console.log("【4】raw_json 完整保留 + 编号一致");
const rawRows = parseSheetRows(files["xl/worksheets/sheet3.xml"] || "");
check("raw_json 数据行 = 1", rawRows.length === 2);
check("raw_json 首列 participant_id 与汇总一致", rawRows[1] && rawRows[1][0] === "EXP-ONE11111");
const rawJson = rawRows[1] ? rawRows[1][1] : "";
let parsed = null;
try { parsed = JSON.parse(rawJson); } catch (e) {}
check("raw_json 单元格为可解析的完整 JSON（非拼凑）", parsed && parsed.participant_id === "EXP-ONE11111" && Array.isArray(parsed.verify.events) && parsed.verify.events.length === 4);

console.log("【5】超长原始 JSON 不静默截断");
let hugeSheets, hugeBytes, hugeFiles;
try {
  hugeSheets = recordsToXlsxSheets([recHuge]);
  // 该记录在 raw_json 单元格会写入“说明文字”而非超长 JSON，故不应抛错
  hugeBytes = buildXlsx(hugeSheets);
  hugeFiles = parseXlsx(hugeBytes);
  const hRaw = parseSheetRows(hugeFiles["xl/worksheets/sheet3.xml"] || "");
  const cell = hRaw[1] ? hRaw[1][1] : "";
  check("超长记录未抛错且 raw_json 为说明文字（非截断 JSON）", cell.indexOf("⚠") === 0 && cell.length < 32767);
  check("超长记录 raw_json 不含被截断的 JSON 花括号片段", cell.indexOf("{") !== 0);
} catch (e) {
  check("超长记录 buildXlsx 不应抛错（已降级）", false);
  console.error("  实际错误：", e.message);
}

console.log("【6】防御：单元格超 32767 时 buildXlsx 不抛错，改为可见说明文字（非静默截断）");
let subBytes, subFiles;
try {
  subBytes = buildXlsx([{ name: "s", rows: [["a", "y".repeat(32768)]] }]);
  subFiles = parseXlsx(subBytes);
  const rows = parseSheetRows(subFiles["xl/worksheets/sheet1.xml"] || "");
  const cell = rows[0] ? rows[0][1] : "";
  check("超长单元格被替换为可见「⚠」说明文字（非截断、文件仍有效）", cell.indexOf("⚠") === 0 && cell.indexOf("32767") >= 0);
} catch (e) {
  check("超长单元格不应抛错（已降级为说明文字）", false);
  console.error("  实际错误：", e.message);
}

console.log("【7】多记录（declined / skipped / in_progress）状态不被错误合并");
const multi = recordsToXlsxSheets([recOpened, recDeclined, recSkipped, recInProgress]);
const mb = buildXlsx(multi);
const mFiles = parseXlsx(mb);
const mSum = parseSheetRows(mFiles["xl/worksheets/sheet1.xml"] || "");
// 4 条记录 → 5 行（含表头）
check("多记录汇总表数据行 = 4", mSum.length === 5);
const statusIdx = mSum[0].indexOf("verify_status");
const inProgIdx = mSum[0].indexOf("status");
const pidIdx = mSum[0].indexOf("participant_id");
const expect = {
  "EXP-ONE11111": ["opened", "completed"],
  "EXP-TWO22222": ["declined", "completed"],
  "EXP-THR33333": ["skipped", "completed"],
  "EXP-FOU44444": ["not_reached", "in_progress"]
};
let allOk = true;
for (let r = 1; r < mSum.length; r++) {
  const pid = mSum[r][pidIdx], ex = expect[pid];
  if (!ex || mSum[r][statusIdx] !== ex[0] || mSum[r][inProgIdx] !== ex[1]) { allOk = false; console.log("    row", pid, "=>", mSum[r][statusIdx], mSum[r][inProgIdx]); }
}
check("四种状态（opened/declined/skipped/not_reached）均正确区分", allOk);
const mEv = parseSheetRows(mFiles["xl/worksheets/sheet2.xml"] || "");
// 事件总数 = 4(opened) + 1(declined) + 0 + 0 = 5
check("多记录 event_log 数据行 = 5（仅 opened/declined 有事件，skipped/in_progress 无）", mEv.length === 6);

console.log("【8】exp-v2 列结构与历史 schema 兼容");
const sumHeader8 = sumRows[0] || [];
check("participant_summary 表头含 schema_version（exp-v2）", sumHeader8.includes("schema_version"));
check("participant_summary 表头含 server_synced / server_received_at", sumHeader8.includes("server_synced") && sumHeader8.includes("server_received_at"));
check("exp-v2 已移除网页问卷列 q1", !sumHeader8.includes("q1"));
check("exp-v2 已移除网页问卷列 ai_awareness", !sumHeader8.includes("ai_awareness"));
check("exp-v2 已移除上轮临时列 q_reading_option", !sumHeader8.includes("q_reading_option"));
check("exp-v2 含核验指标 verify_declined / verify_opened_any", sumHeader8.includes("verify_declined") && sumHeader8.includes("verify_opened_any"));
const schemaIdx = sumHeader8.indexOf("schema_version");
check("汇总行 schema_version = exp-v2", sumRows[1][schemaIdx] === "exp-v2");
// 历史 exp-v1 记录（含问卷列）仍可被解析：验证 buildXlsx 兼容带额外字段的旧记录
const recV1 = {
  schema_version: "exp-v1", participant_id: "EXP-OLD99999", AI_label: 2, evidence_consistency: 1,
  news_version: "AI_label=2 · evidence_consistency=1", consent_given: true, consent_ts: 1700000000000,
  status: "completed", step: 4, started_at: 1700000000000, last_active: 1700000100000, completed_at: 1700000095000,
  reading_time_sec: 30, completion_time_sec: 80,
  q1: "no", q2_consistency: 3, q3_resolvability: 2, q4_false_info: "unknown",
  ai_awareness: "AI生成", ai_manipulation_check: 2, open_feedback: "测试",
  q_reading_option: "C", q_reading_correct: false, q_reading_ts: 1700000050000,
  server_synced: false, server_received_at: null,
  verify: { reached: true, declined: false, opened_any: false, count: 0, types: [], order: [], open: {}, dwell: {}, time: [], events: [] }
};
let oldOk = true;
try {
  const oldBytes = buildXlsx(recordsToXlsxSheets([recV1]));
  const oldFiles = parseXlsx(oldBytes);
  const oldSum = parseSheetRows(oldFiles["xl/worksheets/sheet1.xml"] || "");
  // exp-v2 列序下，旧记录缺失的网页问卷列对应单元格为空串（不报错、不崩溃）
  check("历史 exp-v1 记录仍可生成有效 XLSX（兼容读取）", oldSum.length === 2 && oldSum[1][0] === "EXP-OLD99999");
} catch (e) { oldOk = false; check("历史 exp-v1 记录仍可生成有效 XLSX（兼容读取）", false); console.error("  实际错误：", e.message); }
check("历史 exp-v1 记录 buildXlsx 不抛错", oldOk);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
