-- 记忆文件元数据（迁移版本 9）
--
-- 目的：记录「项目共享记忆文件」与「单个会话记忆文件」是否由 VibeAcross 启用，
-- 以及最近一次初始化的结果。磁盘上的 Markdown 文件仍是内容的事实源，本表只保存
-- 「关联与状态」，不保存任何内容、不保存对话正文。
--
-- 说明：
--  - 仅新增一张表与索引，不修改、不重建既有表，升级后用户已有数据保持不变。
--  - owner_kind 取值：'project'（项目共享记忆）/ 'session'（会话记忆）。
--  - owner_id 指向 projects.id 或 sessions.id；不设外键，避免在删除会话记录时
--    连带丢失「曾创建过记忆文件」的事实。清理由应用层显式处理。
--  - relative_path 为相对项目根的稳定路径：项目为 `.vibeacross/context.md`，
--    会话为 `.vibeacross/sessions/<会话ID>.md`。路径不随会话重命名变化。
--  - status 取值：'pending'（已登记，尚未确认）/ 'created'（本次新建）/
--    'existing'（已存在，保留原内容）/ 'failed'（初始化失败，可重试）。
--  - 同一 owner 只保留一条记录；重复启用为幂等更新。

CREATE TABLE IF NOT EXISTS memory_files (
    id            TEXT PRIMARY KEY NOT NULL,
    owner_kind    TEXT NOT NULL,
    owner_id      TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    UNIQUE (owner_kind, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_files_owner
    ON memory_files (owner_kind, owner_id);
