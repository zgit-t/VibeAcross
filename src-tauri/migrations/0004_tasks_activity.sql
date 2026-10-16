-- Phase 6：任务与活动记录（迁移版本 4）
--
-- 时间字段沿用 UTC ISO 8601 字符串（例如 2026-10-15T08:30:00.000Z）。
-- due_date 使用「日期」语义（YYYY-MM-DD），不包含时区，便于按本地日期展示。
--
-- 说明：
--  - 仅新增表与索引，不修改、不重建版本 1/2/3 的表，保证向前兼容。
--  - 不建立外键约束：SQLite 无法为运行时删除维护外键，且既有的项目删除语义是
--    「仅删除登记记录，不删除磁盘目录」。关联完整性由后端在删除项目/任务时维护：
--    删除项目时一并删除其任务（避免不可访问的孤立任务）；活动记录保留 project_id，
--    即使项目已被删除也能继续展示（前端回退为「已删除的项目」）。

CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY NOT NULL,
    project_id   TEXT NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    status       TEXT NOT NULL,
    priority     TEXT NOT NULL,
    due_date     TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks (priority);
CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks (updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks (created_at);

CREATE TABLE IF NOT EXISTS activity_logs (
    id         TEXT PRIMARY KEY NOT NULL,
    project_id TEXT,
    event_type TEXT NOT NULL,
    summary    TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_logs (project_id);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_logs (event_type);
