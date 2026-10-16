-- 移除活动记录功能（迁移版本 6）
--
-- 活动（Activity）功能已从产品中完整移除，`activity_logs` 表仅供该功能使用，
-- 因此在升级时一并删除。本迁移只删除活动相关的表（及其索引），
-- **不修改** projects / tasks / tool_installations / app_settings /
-- workspace_sessions 等其它表，用户的项目、任务与工具数据保持不变。
--
-- 说明：SQLite 在 `DROP TABLE` 时会自动删除该表上的索引
-- （idx_activity_created / idx_activity_project / idx_activity_type）。

DROP TABLE IF EXISTS activity_logs;
