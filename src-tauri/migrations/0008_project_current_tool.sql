-- 当前工具与关联表对齐（迁移版本 8）。
--
-- 目的：把既有项目的「当前工具」补进关联表，让二者保持一致。
--
-- 背景：
--   - 0003 为 projects 增加了 default_tool_id，记录项目的「当前工具」；
--   - 0007 引入 project_tools 关联表，作为会话的归属容器。
-- 早于本次修复的项目可能已经选过当前工具，但还没有对应关联；这样运行入口按
-- 关联加载工具时会找不到它。此迁移为这类项目补建关联。
--
-- 说明：
--   - 仅新增 project_tools 记录，不修改、不重建既有表，升级后数据保持不变；
--   - 只为「当前工具指向有效工具安装、且尚无同项目同工具关联」的项目补建，
--     已有记录不会被修改或重复创建；
--   - 关联 id 用随机十六进制生成（与后端 uuid 生成的 id 形状一致即可，二者都是
--     不透明主键）；时间戳采用与后端 now_iso() 相同的 ISO-8601 毫秒 UTC 格式。
INSERT INTO project_tools (id, project_id, tool_id, created_at, updated_at)
SELECT
    lower(hex(randomblob(16))),
    p.id,
    p.default_tool_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM projects p
WHERE p.default_tool_id IS NOT NULL
  AND p.default_tool_id <> ''
  AND EXISTS (
      SELECT 1 FROM tool_installations ti WHERE ti.id = p.default_tool_id
  )
  AND NOT EXISTS (
      SELECT 1 FROM project_tools pt
      WHERE pt.project_id = p.id AND pt.tool_id = p.default_tool_id
  );
