import { deriveVerifyStatus } from "./verify.mjs";

// 存储后端统一接口：upsert / get / listAll
// - memoryStore：测试与本地模拟用（注入 env.__store）。
// - d1Store：生产用，绑定 Cloudflare D1（env.DB），具备真实持久化与可查询能力。
// 两种后端返回相同形状的「行对象」，导出时统一解析 raw_json，保证前后端一致。

function rowFromRecord(rec, firstReceived, now) {
  return {
    participant_id: rec.participant_id,
    schema_version: rec.schema_version,
    ai_label: rec.AI_label,
    evidence_consistency: rec.evidence_consistency,
    news_version: rec.news_version || null,
    status: rec.status,
    verify_status: rec.verify_status || deriveVerifyStatus(rec),
    verification: rec.verification,
    verify_count: (rec.verify && rec.verify.count) || 0,
    consent_given: rec.consent_given ? 1 : 0,
    started_at: rec.started_at || null,
    completed_at: rec.completed_at || null,
    server_received_at: firstReceived,
    updated_at: now,
    raw_json: JSON.stringify(rec)
  };
}

export function memoryStore() {
  const m = new Map();
  return {
    async upsert(rec) {
      const now = Date.now();
      const existing = m.get(rec.participant_id);
      const firstReceived = existing ? existing.server_received_at : now;
      const row = rowFromRecord(rec, firstReceived, now);
      m.set(rec.participant_id, row);
      return { stored: !existing, server_received_at: firstReceived };
    },
    async get(pid) {
      return m.get(pid) || null;
    },
    async listAll() {
      return [...m.values()].sort((a, b) => a.server_received_at - b.server_received_at);
    }
  };
}

export function d1Store(db) {
  const COLS = "participant_id, schema_version, ai_label, evidence_consistency, news_version, status, verify_status, verification, verify_count, consent_given, started_at, completed_at, server_received_at, updated_at, raw_json";
  return {
    async upsert(rec) {
      const now = Date.now();
      const ex = await db.prepare("SELECT server_received_at FROM records WHERE participant_id = ?").bind(rec.participant_id).first();
      const firstReceived = ex ? ex.server_received_at : now;
      // 主键 participant_id 幂等；server_received_at 保留首次接收时间，不随重试更新
      await db.prepare(
        `INSERT INTO records (${COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(participant_id) DO UPDATE SET
           schema_version=excluded.schema_version,
           ai_label=excluded.ai_label,
           evidence_consistency=excluded.evidence_consistency,
           news_version=excluded.news_version,
           status=excluded.status,
           verify_status=excluded.verify_status,
           verification=excluded.verification,
           verify_count=excluded.verify_count,
           consent_given=excluded.consent_given,
           started_at=excluded.started_at,
           completed_at=excluded.completed_at,
           updated_at=excluded.updated_at,
           raw_json=excluded.raw_json`
      ).bind(
        rec.participant_id, rec.schema_version, rec.AI_label, rec.evidence_consistency, rec.news_version || null, rec.status,
        rec.verify_status || deriveVerifyStatus(rec), rec.verification, (rec.verify && rec.verify.count) || 0, rec.consent_given ? 1 : 0,
        rec.started_at || null, rec.completed_at || null, firstReceived, now, JSON.stringify(rec)
      ).run();
      return { stored: !ex, server_received_at: firstReceived };
    },
    async get(pid) {
      const r = await db.prepare("SELECT * FROM records WHERE participant_id = ?").bind(pid).first();
      return r || null;
    },
    async listAll() {
      const r = await db.prepare("SELECT * FROM records ORDER BY server_received_at ASC").all();
      return (r && r.results) || [];
    }
  };
}

export function getStore(env) {
  if (env && env.__store) return env.__store; // 测试注入
  if (env && env.DB) return d1Store(env.DB); // 生产 D1
  return null;
}
