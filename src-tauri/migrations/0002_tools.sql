-- Phase 4：开发工具本地安装配置（迁移版本 2）
--
-- 该表只保存「用户的本地安装配置 / 检测结果」，不保存内置工具定义。
-- 内置定义（六款受支持工具）位于 Rust 代码 src/tools/catalog.rs。
-- 同一工具可以有多个安装实例，但同一 tool_id + 路径/命令 不允许重复。

CREATE TABLE IF NOT EXISTS tool_installations (
    id               TEXT PRIMARY KEY NOT NULL,
    tool_id          TEXT NOT NULL,
    name             TEXT NOT NULL,
    vendor           TEXT NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    tool_type        TEXT NOT NULL,
    source           TEXT NOT NULL,
    executable_path  TEXT,
    command_name     TEXT,
    version          TEXT,
    status           TEXT NOT NULL,
    detection_method TEXT,
    is_custom        INTEGER NOT NULL DEFAULT 0,
    is_default       INTEGER NOT NULL DEFAULT 0,
    detected_at      TEXT,
    last_error       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

-- 防止同一工具重复登记同一路径或命令（Windows 路径大小写不敏感）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_install_identity
    ON tool_installations (
        tool_id,
        IFNULL(executable_path, '') COLLATE NOCASE,
        IFNULL(command_name, '') COLLATE NOCASE
    );

-- 全应用最多一个默认工具。
CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_install_default
    ON tool_installations (is_default) WHERE is_default = 1;

CREATE INDEX IF NOT EXISTS idx_tool_install_tool
    ON tool_installations (tool_id);
