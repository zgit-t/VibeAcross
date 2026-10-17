-- 会话数据模型（迁移版本 7）
--
-- 目的：持久化保存「项目 ↔ 工具 ↔ AI 会话」之间的关联，使同一项目、同一工具下的
-- 多个会话可以被长期保存、查询、重命名与恢复。
--
-- 说明：
--  - 仅新增表与索引，不修改、不重建既有表（projects / tool_installations /
--    tasks / workspace_sessions / app_settings），升级后用户已有数据保持不变。
--  - project_tools 是「项目 × 工具关联」表：会话必须且只能属于其中一个关联，
--    因此「每个会话都必须属于一个有效的项目工具关联」由数据库层面的外键保证，
--    而不只依赖前端传入的 id。
--  - 与 Phase 7 的 workspace_sessions（工作环境快照，用于恢复项目 / 工作目录）
--    职责不同：sessions 记录的是 AI 工具会话本身（显示名称、原生会话 ID、工作目录）。
--  - 新表使用真正的外键约束（SQLite 无法为既有表追加外键）：
--      project_tools.project_id → projects(id)           ON DELETE CASCADE
--      project_tools.tool_id    → tool_installations(id) ON DELETE CASCADE
--      sessions.project_tool_id → project_tools(id)       ON DELETE CASCADE
--    删除项目、删除工具安装或删除项目工具关联时，其下的会话记录随之删除。被删除的
--    只是 VibeAcross 自身保存的会话记录，不会触碰任何工具内部的原始会话数据。
--  - 显示名称允许重复（同一工具下可以有多个同名会话），因此不设唯一约束。
--  - 原生会话 ID 允许为空；仅在非空时要求同一项目工具关联下唯一，避免把同一条
--    原生会话重复关联到同一个「项目 × 工具」。
--  - 不保存对话内容、项目文件内容、密钥、访问令牌或环境变量。

CREATE TABLE IF NOT EXISTS project_tools (
    id         TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tool_id    TEXT NOT NULL REFERENCES tool_installations(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_project_tools_project ON project_tools (project_id);
CREATE INDEX IF NOT EXISTS idx_project_tools_tool ON project_tools (tool_id);

CREATE TABLE IF NOT EXISTS sessions (
    id                TEXT PRIMARY KEY NOT NULL,
    project_tool_id   TEXT NOT NULL REFERENCES project_tools(id) ON DELETE CASCADE,
    display_name      TEXT NOT NULL,
    native_session_id TEXT,
    working_directory TEXT,
    status            TEXT NOT NULL DEFAULT 'active',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    last_used_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_project_tool ON sessions (project_tool_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);
CREATE INDEX IF NOT EXISTS idx_sessions_last_used ON sessions (last_used_at DESC);

-- 同一项目工具关联下，同一条原生会话不得重复关联（原生会话 ID 允许为空）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_native_identity
    ON sessions (project_tool_id, native_session_id)
    WHERE native_session_id IS NOT NULL;
