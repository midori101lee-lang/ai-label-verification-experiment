// 服务端逻辑测试（Node 静态 + 模拟）
// 说明：
//  - 静态：校验各模块可被 ESM 正常加载、语法无误。
//  - 模拟：用内存存储（env.__store）驱动真实 app.handle 逻辑，覆盖提交/幂等/校验/鉴权/导出/CORS。
//  - 真实部署（D1 实际执行、浏览器交互、线上端到端）尚未进行，不在本文件范围内（见交付报告）。
import { handle } from "../functions/_shared/app.mjs";
import { memoryStore } from "../functions/_shared/store.mjs";
import { CSV_COLUMNS } from "../functions/_shared/csv.mjs";

const env = { __store: memoryStore(), ADMIN_PASSWORD: "research-pass", JWT_SECRET: "super-secret-jwt" };
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } }

// 统一调用入口：始终注入 env，避免漏传导致 getStore 失效
function req(method, path, body, headers) {
  const hasBody = body !== undefined && body !== null && method !== "GET" && method !== "HEAD";
  return new Request("https://example.com" + path, {
    method,
    headers: headers || {},
    body: hasBody ? JSON.stringify(body) : undefined
  });
}
function H(method, path, body, headers) {
  return handle(path, method, req(method, path, body, headers), env);
}
async function jr(res) { return res.json(); }

function makeRec(pid, opts = {}) {
  return {
    schema_version: "exp-v1",
    participant_id: pid,
    AI_label: opts.ai ?? 1,
    evidence_consistency: opts.ec ?? 0,
    news_version: "AI_label=" + (opts.ai ?? 1) + " · evidence_consistency=" + (opts.ec ?? 0),
    consent_given: true,
    consent_ts: Date.now() - 60000,
    status: opts.status || "completed",
    step: 4,
    started_at: Date.now() - 60000,
    last_active: Date.now(),
    completed_at: Date.now(),
    reading_time_sec: 40,
    completion_time_sec: 95,
    q1: opts.q1 || "yes",
    q2_consistency: opts.q2 ?? 5,
    q3_resolvability: opts.q3 ?? 4,
    q4_false_info: opts.q4 || "no",
    ai_awareness: "AI辅助生成",
    ai_manipulation_check: 1,
    open_feedback: opts.fb || "",
    verify_status: opts.vstatus || "opened",
    verification: opts.verification ?? 1,
    verify: opts.verify || {
      reached: true, declined: false, opened_any: true, count: 2,
      types: ["A 查看原始实验数据", "B 查看研究机构说明"],
      order: ["A 查看原始实验数据", "B 查看研究机构说明"],
      open: { raw: true, inst: true, media: false, fact: false },
      dwell: { raw: 12.3, inst: 8.1 },
      time: [{ type: "raw", sec: 12.3 }, { type: "inst", sec: 8.1 }],
      events: [
        { key: "raw", type: "原始数据", action: "open", ts: Date.now() - 50000 },
        { key: "raw", type: "原始数据", action: "close", ts: Date.now() - 40000 },
        { key: "inst", type: "机构说明", action: "open", ts: Date.now() - 30000 },
        { key: "inst", type: "机构说明", action: "close", ts: Date.now() - 20000 }
      ]
    }
  };
}

console.log("【静态】模块加载与导出");
ok(typeof handle === "function", "app.handle 可导入");
ok(typeof memoryStore === "function", "memoryStore 可导入");
ok(Array.isArray(CSV_COLUMNS) && CSV_COLUMNS[0] === "participant_id", "CSV_COLUMNS 已定义");

console.log("【模拟 1】合法提交 + 幂等（不同设备两条记录）");
let r = await H("POST", "/api/submit", makeRec("EXP-A1B2C3D4"));
let d = await jr(r);
ok(r.status === 200 && d.ok === true && d.stored === true, "首次提交 200/stored=true");
const firstReceived = d.server_received_at;

// 同一 pid 重试（数据略有不同）—— 不应产生重复记录
r = await H("POST", "/api/submit", makeRec("EXP-A1B2C3D4", { q1: "no" }));
d = await jr(r);
ok(r.status === 200 && d.ok === true && d.stored === false, "同 pid 重试 stored=false（幂等，不重复）");
ok(d.server_received_at === firstReceived, "server_received_at 保留首次接收时间");

// 不同 pid（视为不同设备）→ 第二条
r = await H("POST", "/api/submit", makeRec("EXP-E5F6G7H8"));
d = await jr(r);
ok(r.status === 200 && d.ok === true, "第二条记录（不同设备）提交成功");

console.log("【模拟 2】校验拒绝（不应谎报成功）");
r = await H("POST", "/api/submit", makeRec("BAD-ID"));
ok(r.status === 400 && (await jr(r)).ok === false, "非法 participant_id → 400/ok=false");
r = await H("POST", "/api/submit", { ...makeRec("EXP-Z9Y8X7W6"), schema_version: "exp-v2" });
ok(r.status === 400 && (await jr(r)).ok === false, "错误 schema_version → 400/ok=false");
r = await H("POST", "/api/submit", { ...makeRec("EXP-Z9Y8X7W6"), AI_label: 9 });
ok(r.status === 400, "非法 AI_label → 400");

console.log("【模拟 3】研究者后台鉴权");
r = await H("POST", "/api/admin/login", { password: "wrong" });
ok(r.status === 401, "错误密码 → 401");
r = await H("POST", "/api/admin/login", { password: "research-pass" });
d = await jr(r);
ok(r.status === 200 && typeof d.token === "string" && d.token.split(".").length === 3, "正确密码 → 200 + JWT");
const token = d.token;

r = await H("GET", "/api/admin/records");
ok(r.status === 401, "无令牌访问后台 → 401");
r = await H("GET", "/api/admin/records", null, { Authorization: "Bearer " + token });
d = await jr(r);
ok(r.status === 200 && d.ok === true, "带令牌访问后台 → 200");
ok(d.counts.total === 2 && d.counts.completed === 2, "计数正确：total=2, completed=2（两条均来自不同设备）");
ok(d.records.length === 2 && d.records.every(x => x.participant_id.startsWith("EXP-")), "列表含 2 条且编号格式正确");

console.log("【模拟 4】单条详情 + 导出（来自服务端原始记录）");
r = await H("GET", "/api/admin/record/EXP-A1B2C3D4", null, { Authorization: "Bearer " + token });
ok(r.status === 200, "单条详情 200");
let detail = JSON.parse(await r.text());
ok(detail.participant_id === "EXP-A1B2C3D4" && detail.verify.events.length === 4, "详情含完整原始事件（events=4）");
r = await H("GET", "/api/admin/record/NOPE-NOPE", null, { Authorization: "Bearer " + token });
ok(r.status === 404, "不存在编号 → 404");

r = await H("GET", "/api/admin/export/json", null, { Authorization: "Bearer " + token });
let jexp = JSON.parse(await r.text());
ok(Array.isArray(jexp) && jexp.length === 2 && jexp[0].verify.events.length === 4, "JSON 导出 2 条且保留原始事件");

r = await H("GET", "/api/admin/export/csv", null, { Authorization: "Bearer " + token });
let buf = await r.arrayBuffer();
let csv = new TextDecoder("utf-8").decode(buf);
let bom = new Uint8Array(buf).slice(0, 3);
ok(bom[0] === 0xEF && bom[1] === 0xBB && bom[2] === 0xBF, "CSV 含 UTF-8 BOM（原始字节 EF BB BF）");
let lines = csv.split("\n");
ok(lines[0] === CSV_COLUMNS.join(","), "CSV 表头与数据字典列顺序一致");
ok(lines.length === 3, "CSV 含表头 + 2 行数据（无重复）");
const openedRow = lines[1].split(",");
ok(openedRow[CSV_COLUMNS.indexOf("verify_count")] === '"2"', "CSV verify_count=2（打开 2 份不同材料）");

console.log("【模拟 5】数据完整性边界");
// declined：打开 0 份但明确暂不查看 → verification=0, verify_status=declined（不得误为 opened）
await H("POST", "/api/submit", makeRec("EXP-D1E2F3G4", { verification: 0, vstatus: "declined",
  verify: { reached: true, declined: true, opened_any: false, count: 0, types: [], order: [], open: {}, dwell: {}, time: [], events: [{ key: null, type: null, action: "decline", ts: Date.now() }] } }));
// not_reached：未到达核查步骤 → verification=0, verify_status=not_reached（不得误为正常 opened）
await H("POST", "/api/submit", makeRec("EXP-H5I6J7K8", { verification: 0, vstatus: "not_reached",
  verify: { reached: false, declined: false, opened_any: false, count: 0, types: [], order: [], open: {}, dwell: {}, time: [], events: [] } }));
// 打开 3 份不同材料
await H("POST", "/api/submit", makeRec("EXP-L9M0N1O2", { verification: 1, vstatus: "opened",
  verify: { reached: true, declined: false, opened_any: true, count: 3,
    types: ["A", "B", "C"], order: ["A", "B", "C"],
    open: { raw: true, inst: true, media: true, fact: false }, dwell: { raw: 1, inst: 1, media: 1 }, time: [],
    events: [ {key:"raw",type:"A",action:"open",ts:1},{key:"raw",type:"A",action:"close",ts:2},
              {key:"inst",type:"B",action:"open",ts:3},{key:"inst",type:"B",action:"close",ts:4},
              {key:"media",type:"C",action:"open",ts:5},{key:"media",type:"C",action:"close",ts:6} ] } }));

r = await H("GET", "/api/admin/export/csv", null, { Authorization: "Bearer " + token });
csv = new TextDecoder("utf-8").decode(await r.arrayBuffer());
lines = csv.split("\n");
const idx = (pid) => lines.findIndex(l => l.startsWith('"' + pid + '"'));
ok(lines[idx("EXP-D1E2F3G4")].split(",")[CSV_COLUMNS.indexOf("verify_status")] === '"declined"', "declined 记录 verify_status=declined（未被误编码为 opened）");
ok(lines[idx("EXP-H5I6J7K8")].split(",")[CSV_COLUMNS.indexOf("verify_status")] === '"not_reached"', "not_reached 记录 verify_status=not_reached（未被静默编码为 verification=0 正常）");
ok(lines[idx("EXP-L9M0N1O2")].split(",")[CSV_COLUMNS.indexOf("verify_count")] === '"3"', "打开 3 份不同材料 → verify_count=3");
ok(lines.length === 6, "总记录数 = 5 条提交 + 1 表头（幂等无误增）");

console.log("【模拟 6】CORS 预检");
r = await H("OPTIONS", "/api/submit");
ok(r.status === 204 && r.headers.get("Access-Control-Allow-Origin") !== null, "OPTIONS 预检 204 + CORS 头");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
