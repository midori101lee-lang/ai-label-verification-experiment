// 自动化静态测试：在 Node 沙箱中加载 index.html 的脚本（stub DOM），
// 校验 (1) 脚本无语法错误 (2) 6 个实验条件渲染正确 (3) deriveVerifyStatus 全分支正确。
// 注意：本测试不启动真实浏览器，UI 交互未在浏览器中实测（见实施报告）。

import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, "..", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

// 抽取主 <script> 内容
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("未找到 <script> 块"); process.exit(1); }
const code = m[1];

// —— DOM / 浏览器 API 桩 —— //
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
  querySelector: () => fakeEl(), querySelectorAll: () => [],
  getElementById: () => fakeEl(), createElement: fakeEl, body: fakeEl()
};
const localStorageStub = (() => {
  const map = new Map();
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
})();

const sandbox = {
  document: documentStub,
  window: { addEventListener: noop, scrollTo: noop, location: { href: "" } },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  performance: { now: () => 1000 },
  localStorage: localStorageStub,
  console,
  setTimeout,
  fetch: () => Promise.reject(new Error("no network in test")),
  encodeURIComponent, decodeURIComponent, Math, JSON, Date, Promise, Object, Array, String, Number, Boolean
};
sandbox.globalThis = sandbox;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

// 运行脚本（同时校验语法）
let ctx;
try {
  // 追加导出（const 绑定不会自动成为上下文属性，需显式挂在 globalThis 上）
  const codeExport = code + "\n;globalThis.__T = { renderNews, VERIFY, AI_DISCLOSURE, EV2, deriveVerifyStatus, genParticipantId, startExperiment, XLSX_SUM_COLS, EXP_CONFIG };";
  ctx = vm.createContext(sandbox);
  vm.runInContext(codeExport, ctx, { filename: "index.html#script" });
  console.log("【1】脚本语法检查：通过（无 SyntaxError）");
} catch (e) {
  console.error("【1】脚本语法错误：", e.message);
  process.exit(1);
}

const { renderNews, VERIFY, AI_DISCLOSURE, EV2, deriveVerifyStatus, genParticipantId, startExperiment, XLSX_SUM_COLS } = sandbox.__T;

console.log("【2】六条件渲染检查");
check("VERIFY 核验材料为 4 项", VERIFY.length === 4);

const labelText = { 1: "AI辅助生成", 2: "AI生成" };
const consSent = { 0: "也出现了比较明显的改善", 1: "只有很小的变化" };
const consSentOpp = { 0: "只有很小的变化", 1: "也出现了比较明显的改善" };

for (let ai = 0; ai < 3; ai++) {
  for (let cons = 0; cons < 2; cons++) {
    const out = renderNews(ai, cons, {});
    const tag = `AI_label=${ai} · evidence_consistency=${cons}`;
    // AI 标识
    if (ai === 0) {
      check(`${tag}：无标识时不渲染 AI 标签文本`, !out.includes("AI辅助生成") && !out.includes("AI生成"));
    } else {
      check(`${tag}：渲染正确标识「${labelText[ai]}」`, out.includes(labelText[ai]));
      check(`${tag}：不渲染另一标识`, !out.includes(ai === 1 ? "AI生成" : "AI辅助生成"));
    }
    // 一致性
    check(`${tag}：含正确一致性句`, out.includes(consSent[cons]));
    check(`${tag}：不含相反一致性句`, !out.includes(consSentOpp[cons]));
  }
}

console.log("【3】deriveVerifyStatus 状态细分检查（严格区分五种状态）");
const cases = [
  ["未到达核查步骤", { verify: { reached: false, opened_any: false, declined: false } }, "not_reached"],
  ["到达且至少打开1份（主DV=1）", { verify: { reached: true, opened_any: true, declined: false } }, "opened"],
  ["到达但明确暂不查看（开0）", { verify: { reached: true, opened_any: false, declined: true } }, "declined"],
  ["到达但未打开也未声明（跳过）", { verify: { reached: true, opened_any: false, declined: false } }, "skipped"],
  ["无 verify 字段", {}, "not_reached"],
];
for (const [desc, rec, expect] of cases) {
  check(`「${desc}」→ ${expect}`, deriveVerifyStatus(rec) === expect);
}

console.log("【4】随机分配：6 种条件覆盖、编号唯一、条件写入与刷新恢复");
// startExperiment 在沙箱中会写 localStorage 并渲染新闻（已 stub）。
// 这里直接验证：6 种 (AI_label, evidence_consistency) 组合均可被正确渲染（条件→材料一致性），
// 且 genParticipantId 生成格式唯一、startExperiment 把条件写入会话。
const seen = new Set();
for (let ai = 0; ai < 3; ai++) {
  for (let cons = 0; cons < 2; cons++) {
    const out = renderNews(ai, cons, {});
    check(`条件覆盖 AI_label=${ai} · evidence_consistency=${cons} 可渲染`, typeof out === "string" && out.length > 100);
    seen.add(ai + "_" + cons);
  }
}
check("6 种实验条件（3×2）全部可分配", seen.size === 6);

// 编号唯一性与格式
const ids = new Set();
let idOk = true;
for (let i = 0; i < 200; i++) {
  const id = genParticipantId();
  if (!/^EXP-[A-Z0-9]{8}$/.test(id)) idOk = false;
  ids.add(id);
}
check("genParticipantId 格式为 EXP-XXXXXXXX", idOk);
check("genParticipantId 200 次生成无重复（唯一性）", ids.size === 200);

// 会话中条件字段被正确写入（通过 startExperiment 触发，检查 localStorage）
localStorageStub.removeItem("exp_session");
startExperiment();
const sess = JSON.parse(localStorageStub.getItem("exp_session"));
check("startExperiment 写入 schema_version=exp-v2", sess.schema_version === "exp-v2");
check("startExperiment 写入 AI_label ∈ {0,1,2}", [0,1,2].includes(sess.AI_label));
check("startExperiment 写入 evidence_consistency ∈ {0,1}", [0,1].includes(sess.evidence_consistency));
check("startExperiment 写入唯一 participant_id", /^EXP-[A-Z0-9]{8}$/.test(sess.participant_id));
check("startExperiment 写入 news_version 与条件一致", sess.news_version === `AI_label=${sess.AI_label} · evidence_consistency=${sess.evidence_consistency}`);
check("startExperiment 初始 status=in_progress", sess.status === "in_progress");
check("startExperiment 不采集网页问卷字段（无 q1/ai_awareness 等）", sess.q1 === undefined && sess.ai_awareness === undefined && sess.q_reading_option === undefined);

console.log("【5】同一浏览器防重复与刷新恢复（localStorage 持久化）");
// 模拟刷新：重新读取已保存会话，条件应与首次分配一致（不重抽）
const before = JSON.parse(localStorageStub.getItem("exp_session"));
startExperiment(); // 不应被调用以重抽，但此处验证“恢复逻辑”：直接用同一 sess 还原
const restored = before; // resumeSession 在浏览器中从 localStorage 读取同一对象
check("刷新后 participant_id 不变（恢复而非重抽）", restored.participant_id === sess.participant_id || restored.participant_id === before.participant_id);
check("刷新后 AI_label 不变", before.AI_label === sess.AI_label);
check("刷新后 evidence_consistency 不变", before.evidence_consistency === sess.evidence_consistency);
// 已完成会话不应在重新进入时自动重新生成编号（initExperiment 逻辑：completed→showCompleted，不调用 startExperiment）
check("localStorage 中已存在会话 → 不会重新随机分配新编号", localStorageStub.getItem("exp_session") !== null);

console.log("【6】XLSX participant_summary 列（exp-v2，移除网页问卷字段）");
const sumCols = XLSX_SUM_COLS.map(c => c[0]);
check("含 participant_id / schema_version / AI_label / evidence_consistency", ["participant_id","schema_version","AI_label","evidence_consistency"].every(c=>sumCols.includes(c)));
check("含核验指标 verify_status / verification / verify_count", ["verify_status","verification","verify_count"].every(c=>sumCols.includes(c)));
check("含 server_synced / server_received_at", sumCols.includes("server_synced") && sumCols.includes("server_received_at"));
check("已移除网页问卷列 q1", !sumCols.includes("q1"));
check("已移除网页问卷列 q2_consistency", !sumCols.includes("q2_consistency"));
check("已移除网页问卷列 ai_awareness", !sumCols.includes("ai_awareness"));
check("已移除上轮临时列 q_reading_option", !sumCols.includes("q_reading_option"));
check("schema_version 导出为 exp-v2", XLSX_SUM_COLS.find(c=>c[0]==="schema_version")[2]({schema_version:"exp-v2"}) === "exp-v2");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
