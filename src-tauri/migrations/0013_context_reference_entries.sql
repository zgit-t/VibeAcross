-- 共享上下文引用入口的受管元数据（迁移版本 13）
--
-- 目的：让「某条引用入口条目由 VibeAcross 为某个项目创建 / 管理」这一事实有可靠记录，
-- 从而使「安全关闭」只在确有证据证明是 VibeAcross 创建时才移除条目。
--
-- 背景：
--  - `AGENTS.md` / `CLAUDE.md` 入口通过文件内的受管标记（<!-- VibeAcross:... -->）判定
--    所有权，标记即证据，本表不涉及。
--  - OpenCode 的 `instructions` 是纯 JSON 字符串值，无法内嵌标记。若仅凭「值等于
--    `.vibeacross/context.md`」推断所有权，会把**用户手工添加的等价条目**误判为
--    VibeAcross 所有并在关闭时删除。故用本表登记所有权。
--
-- 说明：
--  - 仅新增一张表，不修改、不重建既有表，升级后用户已有数据保持不变。
--  - 无外键：项目 / 文件被删除后记录保留，避免把一条曾被管理的条目不慎当作
--    「用户条目」而拒绝管理；也确实无法在删项目时安全判定其它项目是否依赖它。
--  - 只保存归属元数据（项目身份 + 入口类型 + 目标文件名 + 条目值 + 创建时间），
--    不保存任何对话内容、文件内容、密钥或令牌。

CREATE TABLE IF NOT EXISTS context_reference_entries (
    project_id  TEXT NOT NULL,
    kind        TEXT NOT NULL,
    target_file TEXT NOT NULL,
    entry       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (project_id, kind, target_file, entry)
);

CREATE INDEX IF NOT EXISTS idx_context_reference_entries_project
    ON context_reference_entries (project_id);
