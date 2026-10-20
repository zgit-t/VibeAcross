-- 自动采集的结构化记忆记录与采集开关（迁移版本 10）
--
-- 目的：为「从原生工具（当前仅 OpenCode）自动采集到的会话记录」提供可追溯、可去重的
-- 结构化存储，并把「项目是否启用自动采集」作为独立开关记录下来。
--
-- 存储语义（本阶段明确的边界）：
--  - 自动采集的原始记录以本表（SQLite）为权威存储；它们**不是**已确认的项目共享记忆。
--  - 本表只保存结构化记录与来源索引，绝不写入、覆盖或重建任何 Markdown 记忆文件：
--    `.vibeacross/context.md` 与会话记忆文件仍是用户手工维护的事实源，升级不会改动它们。
--  - 记录 state 区分 candidate（待确认）/ confirmed（用户已确认）/ ignored（用户已忽略）；
--    未经确认的临时结论不会被提升为项目共享记忆。
--  - 只新增两张表与索引，不修改、不重建既有表；升级后用户已有数据保持不变。
--
-- 说明：
--  - record_kind 取值：'project_fact'（项目事实/长期规则，本阶段不由采集自动写入）、
--    'session_progress'（当前会话进度，通常为用户消息）、
--    'ephemeral_finding'（临时发现/待确认结论，通常为助手消息）、
--    'source_index'（工具原生会话/消息来源索引）。
--  - dedup_key 由 (tool_id, native_session_id, record_kind, source_message_id,
--    source_part_id) 派生并唯一约束；同一来源消息因事件重复而反复出现时不会生成第二条。
--  - session_id 指向 VibeAcross 会话（sessions.id）；删除会话时置空但保留记录（仍可追溯）。
--  - NO foreign key on native ids: 原生会话由第三方工具拥有，本表只留存引用字符串。

CREATE TABLE IF NOT EXISTS memory_records (
    id                TEXT PRIMARY KEY NOT NULL,
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tool_id           TEXT NOT NULL,
    session_id        TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    native_session_id TEXT NOT NULL,
    record_kind       TEXT NOT NULL,
    role              TEXT NOT NULL DEFAULT '',
    source_message_id TEXT NOT NULL DEFAULT '',
    source_part_id    TEXT NOT NULL DEFAULT '',
    content           TEXT NOT NULL DEFAULT '',
    content_hash      TEXT NOT NULL,
    metadata          TEXT,
    state             TEXT NOT NULL DEFAULT 'candidate',
    trust             TEXT NOT NULL DEFAULT 'unverified',
    dedup_key         TEXT NOT NULL,
    source_created_at TEXT,
    collected_at      TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    UNIQUE (dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_memory_records_project
    ON memory_records (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_records_session
    ON memory_records (session_id);

CREATE INDEX IF NOT EXISTS idx_memory_records_native
    ON memory_records (project_id, tool_id, native_session_id);

-- 项目 × 工具的自动采集开关与最近一次采集结果（仅元数据，不含对话内容）。
CREATE TABLE IF NOT EXISTS memory_collection (
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tool_id           TEXT NOT NULL,
    enabled           INTEGER NOT NULL DEFAULT 0,
    plugin_installed  INTEGER NOT NULL DEFAULT 0,
    last_status       TEXT NOT NULL DEFAULT 'idle',
    last_error        TEXT,
    last_collected_at TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    PRIMARY KEY (project_id, tool_id)
);
