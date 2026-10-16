-- Phase 7：工作上下文快照（迁移版本 5）
--
-- 说明：
--  - 仅新增表与索引，不修改、不重建版本 1–4 的表，保证向前兼容与数据保留。
--  - 不建立外键约束，与既有 tasks/activity_logs 保持一致。关联完整性由后端维护：
--    删除项目时一并删除其工作上下文；删除工具 / 任务时把对应引用置空，
--    使上下文仍然可用（仅退化为「需要重新选择工具 / 任务」）。
--  - restore_level 记录该上下文实际支持的最高恢复层级。当前仅实现 Level 1
--    （project：恢复项目、工作目录与所选工具），因此只会写入 'project'。
--  - 不保存会话标识、恢复元数据、完整对话内容、密钥、访问令牌、环境变量或文件内容。
--  - 绝对路径不写入本表：项目路径由 projects.path 提供，避免重复保存。

CREATE TABLE IF NOT EXISTS workspace_sessions (
    id                  TEXT PRIMARY KEY NOT NULL,
    project_id          TEXT NOT NULL,
    tool_id             TEXT,
    task_id             TEXT,
    label               TEXT,
    restore_level       TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    last_used_at        TEXT,
    last_restore_status TEXT,
    last_restore_error  TEXT
);

CREATE INDEX IF NOT EXISTS idx_workspace_project ON workspace_sessions (project_id);
CREATE INDEX IF NOT EXISTS idx_workspace_task ON workspace_sessions (task_id);
CREATE INDEX IF NOT EXISTS idx_workspace_updated ON workspace_sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_last_used ON workspace_sessions (last_used_at DESC);
