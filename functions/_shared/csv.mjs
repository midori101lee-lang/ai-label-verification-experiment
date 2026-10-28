import { deriveVerifyStatus } from "./verify.mjs";

// 实验记录 CSV：列顺序与 docs/数据字典.md 的「CSV 导出列」严格一致，
// 含 UTF-8 BOM 便于 Excel 直接打开，缺失值语义与数据字典一致。
export const CSV_COLUMNS = [
  "participant_id", "schema_version", "AI_label", "evidence_consistency", "news_version",
  "consent_given", "verify_reached", "verify_status", "verification", "verify_count", "verify_declined",
  "verify_types", "verify_order", "verify_time",
  "q1", "q2_consistency", "q3_resolvability", "q4_false_info",
  "ai_awareness", "ai_manipulation_check", "open_feedback",
  "reading_time_sec", "completion_time_sec", "status"
];

export function recordsToCsv(records) {
  const esc = (v) => {
    if (v === null || v === undefined || v === "") return "";
    const s = Array.isArray(v) ? JSON.stringify(v) : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const header = CSV_COLUMNS.join(",");
  const rows = records.map((r) => {
    const v = r.verify || {};
    const row = {
      participant_id: r.participant_id,
      schema_version: r.schema_version,
      AI_label: r.AI_label,
      evidence_consistency: r.evidence_consistency,
      news_version: r.news_version,
      consent_given: r.consent_given,
      verify_reached: v.reached,
      verify_status: r.verify_status || deriveVerifyStatus(r),
      verification: r.verification,
      verify_count: v.count,
      verify_declined: v.declined,
      verify_types: v.types,
      verify_order: v.order,
      verify_time: v.time,
      q1: r.q1,
      q2_consistency: r.q2_consistency,
      q3_resolvability: r.q3_resolvability,
      q4_false_info: r.q4_false_info,
      ai_awareness: r.ai_awareness,
      ai_manipulation_check: r.ai_manipulation_check,
      open_feedback: r.open_feedback,
      reading_time_sec: r.reading_time_sec,
      completion_time_sec: r.completion_time_sec,
      status: r.status || "completed"
    };
    return CSV_COLUMNS.map((c) => esc(row[c])).join(",");
  });
  return "﻿" + header + "\n" + rows.join("\n");
}
