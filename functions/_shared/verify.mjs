// 核查状态推导（服务端版，和前端 deriveVerifyStatus 保持一致）
// 严格区分五种状态，绝不把"明确不查看 / 未选择 / 未到达 / 异常"混编为 verification=0：
//   not_reached : 从未到达核查步骤
//   opened      : 至少打开过 1 份材料（主 DV = 1）
//   declined    : 到达但明确点击"暂不查看"，打开数 = 0
//   skipped     : 到达、未打开任何材料、也未明确"暂不查看"
//   abandoned   : （仅当整条记录 incomplete 时由前端额外标记，这里不派生）
export function deriveVerifyStatus(rec) {
  const v = rec && rec.verify;
  if (!v || !v.reached) return "not_reached";
  if (v.opened_any) return "opened";
  if (v.declined) return "declined";
  return "skipped";
}
