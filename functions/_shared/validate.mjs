import { deriveVerifyStatus } from "./verify.mjs";

// 对参与者提交记录做最小化校验（不保存浏览器未发送的内容）。
// 返回 null 表示通过；返回字符串表示拒绝原因。
export function validateRecord(rec) {
  if (!rec || typeof rec !== "object") return "payload must be an object";
  if (rec.schema_version !== "exp-v1") return "unsupported schema_version (expected exp-v1)";
  const pid = rec.participant_id;
  if (typeof pid !== "string" || !/^EXP-[A-Z0-9]{8}$/.test(pid)) return "invalid participant_id";
  if (![0, 1, 2].includes(rec.AI_label)) return "invalid AI_label";
  if (![0, 1].includes(rec.evidence_consistency)) return "invalid evidence_consistency";
  if (rec.status !== "completed" && rec.status !== "in_progress") return "invalid status";
  if (!rec.verify || typeof rec.verify !== "object") return "missing verify object";
  return null;
}

export { deriveVerifyStatus };
