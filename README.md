# VibeAcross

面向 Vibe Coding 开发者的本地桌面工作区管理工具，用于统一管理本地开发项目、AI 编程工具、开发任务与工作上下文。

- **目标平台**：Windows 10 / Windows 11
- **当前阶段**：Phase 8 交付后的维护与修复（功能冻结；已移除活动模块、替换应用图标、校正设置项与工作上下文语义、修复 AI 工具检测与安全启动可靠性、新增本地数据备份与恢复、新增项目健康检查与快捷操作、新增全局只读搜索与应用内联动、完成回归测试与 Windows 打包验收）。进度与验证结果见 `docs/PROJECT_STATUS.md`。
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

左侧可折叠导航：Overview / Projects / Tools / Tasks / Sessions，底部为 Settings 与 About。
支持浅色 / 深色 / 跟随系统主题，以及中文（zh-CN）/ 英文（en-US）界面切换；`Ctrl/Cmd + K` 可打开全局搜索。详细说明见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。

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
| `msi/VibeAcross_0.2.0_x64_zh-CN.msi` | Windows Installer 安装包（适合普通用户安装） |
| `nsis/VibeAcross_0.2.0_x64-setup.exe` | NSIS 安装程序 |

安装包只包含运行所需的前端资源与后端程序，不包含源代码、开发数据库或临时文件。安装与卸载均不影响 `%APPDATA%\com.vibeacross.app` 中的用户数据。

## 本地数据

- SQLite 数据库位于系统应用数据目录：Windows 为 `%APPDATA%\com.vibeacross.app\vibeacross.db`。
- 数据库结构由 `src-tauri/migrations/` 中的迁移脚本管理，版本记录在 `PRAGMA user_version`，可安全重复执行。
- 项目、设置、工具安装配置、任务与工作上下文均保存在该文件中；移除项目或工具配置只删除记录，不会删除磁盘目录或卸载软件。
- 任务始终关联一个有效项目；移除项目时会一并删除其任务（避免孤立任务）。
- 工具检测全部在本机完成，不上传路径或环境变量，不下载或安装任何软件。
- 工具启动只接受「项目 id + 工具安装 id」；使用明确的可执行文件路径与参数，**不拼接 shell、不做文本插值**。`.exe` 直接创建进程；npm 安装的 `.cmd` / `.bat` 仅经**受控** Windows 命令解释器（`/d /v:off /s /c` + 对结构化路径与参数的安全引用）启动，含无法安全转义字符的路径会被拒绝并提示。
- 工作上下文（Phase 7）保存「项目 + 工具 + 任务」组合，只实现 Level 1（恢复项目、工作目录与所选工具）；不保存会话标识或对话内容。删除项目会一并删除其上下文，删除任务或工具只把对应引用置空。
- 「启动时显示最近的工作上下文」**默认开启**，仅控制概览页「恢复工作环境」区块是否显示；自动恢复**默认关闭**，仅在用户于 Settings 显式开启后于启动时执行一次。恢复失败会记录脱敏原因并退回正常界面，不会删除任何用户数据。
- 设置页「数据备份与恢复」可创建数据库一致性备份（单文件 `.vibeacross-backup`）并从备份恢复；备份**只含应用数据库**，不含项目目录中的源代码，也不含任何令牌或密码（数据库本身不保存此类信息）。恢复会覆盖当前数据，恢复前自动保留一份保护性备份（`vibeacross.pre-restore-*.db`），失败时自动回滚；恢复成功后界面会自动重新加载。
- 项目详情提供「项目健康」区块：**目录有效性**与**默认工具启动能力分开呈现**，可「重新检查」；支持在系统文件管理器中打开目录、复制路径，以及失效路径的重新定位（应用前确认，**不移动 / 复制 / 删除任何源代码**）。健康检查为按需只读操作，不做后台轮询。
- 全局搜索（阶段 05）：侧边栏入口或 `Ctrl/Cmd + K` 打开统一只读搜索，检索项目名称 / 备注、任务标题 / 描述、工作上下文名称与关联名称；**不读取或索引项目源代码**，不做全盘扫描。结果按项目 / 任务 / 工作上下文分组并支持键盘导航，可从搜索结果或列表跳转到对应项目 / 任务 / 上下文；任务编辑弹窗显示所属项目路径与默认工具状态。

详细的环境配置、目录结构与开发规范见 [`docs/`](./docs)。

## 已知限制

- 会话恢复（Level 2 / Level 3）不提供操作；Claude Code、Codex CLI、OpenCode 的官方恢复机制仅标注为「尚未验证」，本机未安装、未验证。
- WorkBuddy 安装位置不可预测，且无公开启动参数，不支持受控启动；Claude Code / Codex CLI / OpenCode 因本机未安装，其真机启动未验证（`.cmd` 启动路径由测试覆盖）。Trae / Cursor 的受控启动已在本机验证。
- 未在打包后的桌面应用中做端到端点击验证；前端以类型检查、生产构建、单元测试与无头浏览器渲染冒烟覆盖，后端以集成测试覆盖。
- 一个项目只有一个默认开发工具；不检测工具是否已在运行（重复启动防抖仅覆盖短时间窗口）。
- 备份 / 恢复为手动、单文件操作：不提供云同步或自动定时备份；恢复成功后需重新加载界面（应用会自动执行）。

发布说明见 [`docs/RELEASE_NOTES.md`](./docs/RELEASE_NOTES.md)，当前进度与验证结果见 [`docs/PROJECT_STATUS.md`](./docs/PROJECT_STATUS.md)。
