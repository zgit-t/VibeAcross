-- Phase 5：项目与开发工具的关联（迁移版本 3）
--
-- 为项目增加「默认开发工具」字段，记录该项目偏好的工具安装配置。
-- 这里保存的是 tool_installations.id（安装实例），而不是内置工具的 tool_id，
-- 因为同一款工具在本机可能有多个安装实例。
--
-- 说明：
--  - 仅新增可空列，不修改、不重建版本 1/2 的表，保证向前兼容且不破坏既有项目数据。
--  - 不建立外键约束：SQLite 不支持对已有表追加外键；引用完整性由后端在删除工具时维护
--    （删除工具安装时会把引用它的项目 default_tool_id 置空）。
--  - 若引用的工具被移除或失效，后端在读取/启动时会给出明确原因，前端允许重新选择。

ALTER TABLE projects ADD COLUMN default_tool_id TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_default_tool
    ON projects (default_tool_id);
