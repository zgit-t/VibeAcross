-- VibeAcross 初始数据库结构（迁移版本 1）
--
-- 时间字段统一使用 UTC ISO 8601 字符串（例如 2026-10-15T08:30:00.000Z）。
-- is_favorite 使用 0/1 整数存储布尔值。

CREATE TABLE IF NOT EXISTS projects (
    id             TEXT PRIMARY KEY NOT NULL,
    name           TEXT NOT NULL,
    path           TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    last_opened_at TEXT,
    description    TEXT,
    is_favorite    INTEGER NOT NULL DEFAULT 0
);

-- 同一本地目录不得重复导入；Windows 路径大小写不敏感，使用 NOCASE 比较。
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path
    ON projects (path COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_projects_last_opened
    ON projects (last_opened_at);

CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
