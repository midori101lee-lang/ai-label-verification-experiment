import { validateRecord } from "./validate.mjs";
import { issueToken, verifyToken, timingSafeEqualStr } from "./auth.mjs";
import { recordsToCsv } from "./csv.mjs";
import { getStore } from "./store.mjs";

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra }
  });
}
function cors(env) {
  const o = env && env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN : "*";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

// 统一入口：path 为请求路径，method 为 HTTP 方法。
// Pages Functions 与独立 Worker 都调用本函数，便于同一套逻辑被测试。
export async function handle(path, method, request, env) {
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  try {
    if (path === "/api/submit" && method === "POST") return await submit(request, env);
    if (path === "/api/admin/login" && method === "POST") return await login(request, env);
    if (path.startsWith("/api/admin/")) return await admin(path, request, env);
    return new Response("Not Found", { status: 404 });
  } catch (e) {
    return json({ ok: false, error: "server_error: " + e.message }, 500);
  }
}

async function submit(request, env) {
  let rec;
  try {
    rec = await request.json();
  } catch (_) {
    return json({ ok: false, error: "invalid JSON body" }, 400, cors(env));
  }
  const err = validateRecord(rec);
  if (err) return json({ ok: false, error: err }, 400, cors(env));

  const store = getStore(env);
  if (!store) return json({ ok: false, error: "storage not configured" }, 500, cors(env));

  // 以 participant_id 为主键幂等写入；重试不会产生重复记录。
  const res = await store.upsert(rec);
  return json(
    { ok: true, stored: res.stored, server_received_at: res.server_received_at },
    200,
    cors(env)
  );
}

async function login(request, env) {
  if (!env.ADMIN_PASSWORD || !env.JWT_SECRET) {
    return json({ ok: false, error: "admin auth not configured" }, 500);
  }
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const ok = timingSafeEqualStr(String((body && body.password) || ""), String(env.ADMIN_PASSWORD));
  if (!ok) return json({ ok: false, error: "invalid password" }, 401);
  const token = await issueToken(env.JWT_SECRET, 8 * 3600);
  return json({ ok: true, token });
}

async function admin(path, request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const claims = token ? await verifyToken(token, env.JWT_SECRET) : null;
  if (!claims) return json({ ok: false, error: "unauthorized" }, 401);

  const store = getStore(env);
  if (!store) return json({ ok: false, error: "storage not configured" }, 500);

  // 列表 + 计数
  if (path === "/api/admin/records" && request.method === "GET") {
    const all = await store.listAll();
    const counts = { total: all.length, completed: 0, in_progress: 0 };
    all.forEach((r) => {
      if (r.status === "completed") counts.completed++;
      else if (r.status === "in_progress") counts.in_progress++;
    });
    const records = all.map((r) => ({
      participant_id: r.participant_id,
      status: r.status,
      started_at: r.started_at,
      completed_at: r.completed_at,
      server_received_at: r.server_received_at,
      AI_label: r.ai_label,
      evidence_consistency: r.evidence_consistency,
      verify_status: r.verify_status,
      verification: r.verification
    }));
    return json({ ok: true, counts, records });
  }

  // 单条详情（返回服务端保存的原始 JSON，含完整事件）
  const m = path.match(/^\/api\/admin\/record\/(.+)$/);
  if (m && request.method === "GET") {
    const r = await store.get(decodeURIComponent(m[1]));
    if (!r) return json({ ok: false, error: "not found" }, 404);
    return new Response(r.raw_json, { headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  // 批量导出 JSON（来自服务端原始记录）
  if (path === "/api/admin/export/json" && request.method === "GET") {
    const all = await store.listAll();
    const data = all.map((r) => JSON.parse(r.raw_json));
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  // 批量导出 CSV（稳定列顺序 + BOM）
  if (path === "/api/admin/export/csv" && request.method === "GET") {
    const all = await store.listAll();
    const data = all.map((r) => JSON.parse(r.raw_json));
    return new Response(recordsToCsv(data), {
      headers: { "Content-Type": "text/csv; charset=utf-8" }
    });
  }

  return json({ ok: false, error: "unknown admin route" }, 404);
}
