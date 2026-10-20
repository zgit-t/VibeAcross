-- 原生会话归属登记（迁移版本 12）
--
-- 目的：让「某条原生会话属于哪个 VibeAcross 项目身份」这一事实在项目被移除后依然
-- 保留下来，从而避免在**相同路径重建同名项目**时，把旧项目遗留的原生会话自动重新
-- 归入新项目。项目身份是 VibeAcross 生成的 UUID，而不是路径或名称。
--
-- 说明：
--  - 仅新增一张表与索引，不修改、不重建既有表，升级后用户已有数据保持不变。
--  - tool_id 为内置工具标识（tool_installations.tool_id，如 "opencode"），
--    native_session_id 为工具公开的原生会话标识；两者共同构成一条原生会话的稳定身份。
--  - project_id 记录「认领时」的项目身份。**刻意不设外键**：项目 / 工具被删除后，
--    这条归属事实必须保留，才能识别出「已被移除项目的原生会话」而不再自动接管。
--  - 语义：一条原生会话一旦被某个项目身份认领，就只属于该项目身份；其它（含同路径
--    重建的新）项目在同步时不得自动认领，只能由用户事后显式处理。
--  - 回填：从既有的本地会话记录推导归属，使升级前已关联的会话在升级后依然被视为
--    「已认领」，避免升级后重建项目时出现回归。
--  - 歧义处理：若同一条原生会话在历史数据里同时挂在**多个项目**下（旧缺陷遗留），
--    其归属无法可靠判断。此类记录**不回填**（保持未认领），绝不静默认领给任意一个
--    项目；仅在恰好归属唯一项目时才回填。

CREATE TABLE IF NOT EXISTS native_session_claims (
    tool_id           TEXT NOT NULL,
    native_session_id TEXT NOT NULL,
    project_id        TEXT NOT NULL,
    claimed_at        TEXT NOT NULL,
    PRIMARY KEY (tool_id, native_session_id)
);

CREATE INDEX IF NOT EXISTS idx_native_session_claims_project
    ON native_session_claims (project_id);

INSERT OR IGNORE INTO native_session_claims (tool_id, native_session_id, project_id, claimed_at)
SELECT ti.tool_id, s.native_session_id, MIN(pt.project_id), MIN(s.created_at)
FROM sessions s
JOIN project_tools pt ON pt.id = s.project_tool_id
JOIN tool_installations ti ON ti.id = pt.tool_id
WHERE s.native_session_id IS NOT NULL
  AND TRIM(s.native_session_id) <> ''
GROUP BY ti.tool_id, s.native_session_id
HAVING COUNT(DISTINCT pt.project_id) = 1;
