# VibeAcross

面向 Vibe Coding 开发者的本地桌面工作区管理工具，用于统一管理本地开发项目、AI 编程工具、开发任务与工作记录。

- **目标平台**：Windows 10 / Windows 11
- **当前阶段**：Phase 8 — QA、打包与发布准备（自动化测试、Windows 安装包生成、安装/卸载/数据保护验证与文档完善）
- **设计原则**：本地优先。数据保存在本机 SQLite，不接入远程服务器，不实现账号、云同步或大模型 API。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2 |
| 前端 | React 19 + TypeScript（严格模式） |
| 构建 | Vite |
| 图标 | lucide-react |
| 后端 | Rust |
| 数据库 | SQLite（rusqlite，bundled） |
| 注册表 | winreg（仅 Windows，只读） |
| 系统对话框 | tauri-plugin-dialog |
| 样式 | CSS 变量设计令牌 + CSS Modules |
| 包管理 | npm |

## 界面结构

左侧可折叠导航：Overview / Projects / Tools / Tasks / Sessions / Activity，底部为 Settings 与 About。
支持浅色 / 深色 / 跟随系统主题。详细说明见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。

## 快速开始

前置条件：Node.js 20+、npm，以及 Rust 工具链（见 `docs/DEVELOPMENT.md`）。

```bash
# 安装前端依赖
npm install

# 仅前端浏览器预览（无桌面后端）
npm run dev

# 启动 Tauri 桌面开发环境（需 Rust）
npm run tauri:dev
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器（浏览器模式） |
| `npm run typecheck` | TypeScript 严格类型检查 |
| `npm run test` | 运行前端单元测试（Vitest + Testing Library） |
| `npm run build` | 类型检查并执行前端生产构建 |
| `npm run preview` | 预览前端生产构建 |
| `npm run tauri:dev` | 启动 Tauri 桌面开发窗口 |
| `npm run tauri:build` | 构建 Tauri 桌面安装包（MSI + NSIS） |

Rust 后端测试（需 Rust 工具链）：`cargo test`（在 `src-tauri/` 目录下执行）。

## Windows 打包

```bash
npm run tauri:build
```

产出（`src-tauri/target/release/bundle/`）：

| 产物 | 说明 |
| --- | --- |
| `msi/VibeAcross_0.1.0_x64_zh-CN.msi` | Windows Installer 安装包（适合普通用户安装） |
| `nsis/VibeAcross_0.1.0_x64-setup.exe` | NSIS 安装程序 |

安装包只包含运行所需的前端资源与后端程序，不包含源代码、开发数据库或临时文件。安装与卸载均不影响 `%APPDATA%\com.vibeacross.app` 中的用户数据。

## 本地数据

- SQLite 数据库位于系统应用数据目录：Windows 为 `%APPDATA%\com.vibeacross.app\vibeacross.db`。
- 数据库结构由 `src-tauri/migrations/` 中的迁移脚本管理，版本记录在 `PRAGMA user_version`，可安全重复执行。
- 项目、设置、工具安装配置、任务、活动记录与工作上下文均保存在该文件中；移除项目或工具配置只删除记录，不会删除磁盘目录或卸载软件。
- 任务始终关联一个有效项目；移除项目时会一并删除其任务（避免孤立任务），但活动记录保留。
- 活动记录只保存应用内的可读操作摘要，不涉及系统级监控，也不保存完整命令行、令牌或文件内容；可在 Settings 或 Activity 页面清理。
- 工具检测全部在本机完成，不上传路径或环境变量，不下载或安装任何软件。
- 工具启动只接受「项目 id + 工具安装 id」，使用明确的可执行文件路径与参数，不经由 shell 执行用户输入。
- 工作上下文（Phase 7）保存「项目 + 工具 + 任务」组合，只实现 Level 1（恢复项目、工作目录与所选工具）；不保存会话标识或对话内容。删除项目会一并删除其上下文，删除任务或工具只把对应引用置空。
- 自动恢复**默认关闭**，仅在用户于 Settings 显式开启后于启动时执行一次；恢复失败会记录脱敏原因并退回正常界面，不会删除任何用户数据。

详细的环境配置、目录结构与开发规范见 [`docs/`](./docs)。

## 已知限制

- 会话恢复（Level 2 / Level 3）不提供操作；Claude Code、Codex CLI、OpenCode 的官方恢复机制仅标注为「尚未验证」，本机未安装、未验证。
- WorkBuddy 安装位置不可预测，不支持受控启动；本机未提供 Trae / Cursor / WorkBuddy 的真机启动验证。
- 未在打包后的桌面应用中做端到端点击验证；前端以类型检查、生产构建、单元测试与无头浏览器渲染冒烟覆盖，后端以集成测试覆盖。
- 一个项目只有一个默认开发工具；不检测工具是否已在运行（重复启动防抖仅覆盖短时间窗口）。

发布说明见 [`docs/RELEASE_NOTES.md`](./docs/RELEASE_NOTES.md)，当前进度与验证结果见 [`docs/PROJECT_STATUS.md`](./docs/PROJECT_STATUS.md)。
