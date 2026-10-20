-- 记忆记录「共享记忆晋升」状态（迁移版本 11）
--
-- 目的：在既有 `memory_records`（迁移 10）之上，补充「审核决定」与「是否已写入共享
-- 记忆」这两个**互相独立**的概念所缺少的字段。
--
-- 为什么必须分开（本阶段的核心语义）：
--  - `state`（candidate / confirmed / ignored）表达的是**用户的审核决定**，不表达写入结果。
--  - 用户可以把一条记录标记为 confirmed（认可其长期价值），但尚未（或未能）写入
--    `.vibeacross/context.md`。把 confirmed 直接当成「已写入共享记忆」会谎报状态。
--  - 因此新增三个字段，独立记录「晋升状态 / 晋升时间 / 晋升错误」，与 `state` 互不覆盖。
--
-- 字段语义：
--  - promotion_state: 'none'（未晋升，默认）| 'promoted'（已成功写入共享记忆）
--    | 'failed'（晋升失败，可重试）。
--  - promoted_at: 成功晋升的时间戳（UTC ISO 8601）；未晋升 / 失败时为 NULL。
--  - promotion_error: 最近一次晋升失败的可诊断说明（**不含对话正文**）；成功 / 未晋升时为 NULL。
--
-- 兼容性：仅对既有表追加可空 / 带默认值的列，不修改、不重建既有列；
-- 既有行的 promotion_state 自动填充为 'none'，不会破坏或改变任何已有数据。
-- 采集写入（`memory_records::ingest`）的 INSERT / UPDATE 均不涉及这三列，
-- 因此重复采集或正文更新不会重置用户的审核决定，也不会改变已有的晋升状态。

ALTER TABLE memory_records ADD COLUMN promotion_state TEXT NOT NULL DEFAULT 'none';
ALTER TABLE memory_records ADD COLUMN promoted_at TEXT;
ALTER TABLE memory_records ADD COLUMN promotion_error TEXT;

CREATE INDEX IF NOT EXISTS idx_memory_records_promotion
    ON memory_records (project_id, promotion_state);
