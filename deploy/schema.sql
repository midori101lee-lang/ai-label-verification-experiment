-- D1 实验记录表（Cloudflare SQLite）
-- 以 participant_id 为主键实现幂等；raw_json 保存参与者提交的完整原始记录（含核查事件）。
CREATE TABLE IF NOT EXISTS records (
  participant_id      TEXT PRIMARY KEY,
  schema_version      TEXT NOT NULL,
  ai_label            INTEGER NOT NULL,
  evidence_consistency INTEGER NOT NULL,
  news_version        TEXT,
  status              TEXT NOT NULL,            -- completed | in_progress
  verify_status       TEXT,                    -- not_reached|opened|declined|skipped
  verification        INTEGER,                 -- 主 DV：至少打开 1 份 = 1
  verify_count        INTEGER,                 -- 打开过的不同材料数
  consent_given       INTEGER,
  started_at          INTEGER,
  completed_at        INTEGER,
  server_received_at  INTEGER NOT NULL,        -- 首次接收时间（重试不更新）
  updated_at          INTEGER NOT NULL,
  raw_json            TEXT NOT NULL            -- 完整原始记录（JSON 导出直接回放）
);
CREATE INDEX IF NOT EXISTS idx_records_received ON records(server_received_at);
