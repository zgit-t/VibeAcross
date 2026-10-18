/**
 * 领域数据类型。
 *
 * 这些类型与 Rust 后端的 serde 输出保持一致（字段使用 camelCase），
 * 前端仅通过 Tauri 命令获取真实数据。
 */

/** 工具检测状态。与 Rust 后端 `tools::model::ToolStatus` 一致。 */
export type ToolStatus =
  | "detected"
  | "notDetected"
  | "notInstalled"
  | "pathMissing"
  | "unverified"
  | "detectionFailed";

/** 工具类型：桌面应用或命令行工具。 */
export type ToolType = "desktop" | "cli";

/** 工具条目的来源。 */
export type ToolSource = "auto" | "manual" | "builtin";

/** 工具的受控启动方式。与 Rust 后端 `tools::model::LaunchMethod` 一致。 */
export type LaunchMethod = "folderArgument" | "workingDirectory";

/** 工具是否支持受控启动。与 Rust 后端 `tools::model::LaunchSupport` 一致。 */
export type LaunchSupport =
  | "supported"
  | "needsConfiguration"
  | "unsupported"
  | "unavailable";

/** 工具启动能力说明，随 `ToolEntry` 一起返回。 */
export interface ToolLaunchInfo {
  support: LaunchSupport;
  /** 支持启动时使用的启动方式；其余情况为 null。 */
  method: LaunchMethod | null;
  /** 面向用户的原因 / 说明。 */
  reason: string;
}

/** 工作上下文恢复层级。与 Rust 后端 `tools::model::RestoreLevel` 一致。 */
export type RestoreLevel = "none" | "project" | "session" | "fullContext";

/** 工具对会话恢复（Level 2/3）的公开机制情况。 */
export type SessionResumeSupport = "unsupported" | "documentedUnverified";

/** 工具的恢复能力说明，随 `ToolEntry` 一起返回。 */
export interface ToolRestoreInfo {
  /** 该工具当前可支持的最高恢复层级。 */
  level: RestoreLevel;
  /** 恢复层级的说明（支持或不支持的原因）。 */
  levelReason: string;
  /** 会话恢复（Level 2/3）的支持情况。 */
  session: SessionResumeSupport;
  /** 会话恢复能力的说明与已知限制。 */
  sessionReason: string;
}

/** 一次成功启动的结果。仅表示进程已创建，不代表工具已完成初始化。 */
export interface LaunchResult {
  projectId: string;
  projectName: string;
  toolId: string;
  toolName: string;
  pid: number;
  method: LaunchMethod;
  workingDir: string;
  arguments: string[];
  /**
   * 本次启动是否同时在目标工具中创建 / 恢复了任务或会话上下文。
   * 仅当本次启动附加了受控的会话参数（如恢复某个原生会话）时为 true；
   * 普通「打开项目」启动不注入任何会话参数，为 false。
   */
  contextInitialized: boolean;
}

/** 开发工具条目。字段与 Rust 后端 `tools::model::ToolEntry` 序列化结果一致。 */
export interface ToolEntry {
  id: string;
  /** 所属工具定义标识（内置工具为目录 id，自定义工具为生成的 id）。 */
  toolId: string;
  name: string;
  vendor: string;
  description: string;
  toolType: ToolType;
  source: ToolSource;
  status: ToolStatus;
  executablePath: string | null;
  commandName: string | null;
  version: string | null;
  detectionMethod: string | null;
  isCustom: boolean;
  isDefault: boolean;
  detectedAt: string | null;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** 该工具是否具备可靠的自动检测方式。 */
  autoDetectReliable: boolean;
  detectionNote: string;
  /** 受控启动能力与方式。 */
  launch: ToolLaunchInfo;
  /** 工作上下文恢复能力（Level 1 与更高层级的可用情况）。 */
  restore: ToolRestoreInfo;
  /** 便捷字段：status === "detected"。 */
  installed: boolean;
}

/** 工具列表整体状态。 */
export interface ToolState {
  entries: ToolEntry[];
  lastDetectionAt: string | null;
}

/** 新增/编辑工具配置的输入。 */
export interface ToolConfigInput {
  toolId?: string | null;
  name?: string | null;
  toolType?: ToolType | null;
  executablePath?: string | null;
  commandName?: string | null;
}

/** 本地开发项目。字段与 Rust 后端 `models::Project` 序列化结果一致。 */
export interface Project {
  id: string;
  name: string;
  /** 项目本地绝对路径（已规范化）。 */
  path: string;
  /** 创建时间（ISO 8601，UTC）。 */
  createdAt: string;
  /** 最近更新时间（ISO 8601，UTC）。 */
  updatedAt: string;
  /** 最近访问时间（ISO 8601，UTC），从未访问时为 null。 */
  lastOpenedAt: string | null;
  /** 备注，未填写时为 null。 */
  description: string | null;
  /** 是否已收藏。 */
  isFavorite: boolean;
  /** 关联的默认开发工具安装 id，未关联时为 null。 */
  defaultToolId: string | null;
  /** 目录当前是否存在且为目录（查询时即时计算）。 */
  pathExists: boolean;
}

/** 项目列表排序方式。 */
export type ProjectSort = "recent" | "created" | "name";

/** 项目路径健康状态。与 Rust 后端 `health::PathStatus` 一致。 */
export type ProjectPathStatus =
  | "ok"
  | "missing"
  | "notDirectory"
  | "inaccessible"
  | "unknown";

/** 默认工具的启动能力分类。与 Rust 后端 `health::ToolHealthStatus` 一致。 */
export type ProjectToolHealth =
  | "notConfigured"
  | "missing"
  | "unavailable"
  | "notLaunchable"
  | "ready";

/**
 * 单个项目的健康检查结果（项目路径健康与默认工具启动能力分开返回）。
 * 与 Rust 后端 `health::ProjectHealth` 一致。
 */
export interface ProjectHealth {
  projectId: string;
  pathStatus: ProjectPathStatus;
  toolStatus: ProjectToolHealth;
  /** 项目关联的默认工具安装 id；未设置时为 null。 */
  toolId: string | null;
}

/** 应用设置。与 Rust 后端 `models::AppSettings` 对应。 */
export interface AppSettings {
  defaultProjectFolder: string | null;
  theme: string | null;
  /** 启动时是否展示最近的上下文（Phase 7）。 */
  showLastContextOnStartup: boolean;
  /** 启动时是否自动恢复最近的工作上下文（Phase 7）。 */
  autoRestoreLastContext: boolean;
  /** 界面语言（如 zh-CN / en-US）；未设置时为 null，由前端回退到默认语言。 */
  language: string | null;
  /** 是否在启动后自动检查更新。默认为 false（仅用户开启后才联网）。 */
  autoUpdate: boolean;
}

/** 本地数据存储信息。 */
export interface StorageInfo {
  databasePath: string;
  appDataDir: string;
}

/** 诊断日志文件状态。与 Rust 后端 `models::DiagnosticsInfo` 对应。 */
export interface DiagnosticsInfo {
  /** 文件绝对路径（查询时为日志文件；导出时为导出的目标文件）。 */
  path: string;
  /** 文件是否已存在。 */
  exists: boolean;
  /** 文件字节数。 */
  sizeBytes: number;
}

/** 诊断日志内容（供设置页在应用内查看）。 */
export interface DiagnosticsContent {
  /** 日志文件绝对路径。 */
  path: string;
  /** 日志正文（必要时仅返回末尾部分）。 */
  content: string;
  /** 是否因超出限制而截断。 */
  truncated: boolean;
  /** 文件完整字节数。 */
  sizeBytes: number;
}

/** 任务状态。与 Rust 后端 `tasks::TaskStatus` 一致。 */
export type TaskStatus = "todo" | "inProgress" | "done";

/** 任务优先级。与 Rust 后端 `tasks::TaskPriority` 一致。 */
export type TaskPriority = "low" | "medium" | "high";

/** 开发任务。字段与 Rust 后端 `tasks::Task` 序列化结果一致。 */
export interface Task {
  id: string;
  /** 所属项目 id。任务始终归属一个有效项目。 */
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  /** 截止日期（YYYY-MM-DD），未设置时为 null。 */
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  /** 完成时间，未完成时为 null。 */
  completedAt: string | null;
}

/** 创建 / 编辑任务的输入。 */
export interface TaskInput {
  projectId: string;
  title: string;
  description?: string | null;
  /** 创建时缺省为 todo；编辑时缺省保留原状态。 */
  status?: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
}

/** 任务列表排序方式。 */
export type TaskSort = "created" | "updated";

/** 任务列表查询条件。 */
export interface TaskQuery {
  projectId?: string | null;
  status?: TaskStatus | null;
  priority?: TaskPriority | null;
  /** 标题 / 描述关键词。 */
  search?: string | null;
  sort?: TaskSort;
}

/** 任务统计（按状态计数）。 */
export interface TaskStats {
  todo: number;
  inProgress: number;
  done: number;
  total: number;
}

/**
 * 任务搜索结果：任务本体 + 所属项目信息（用于展示与导航）。
 * 与 Rust 后端 `search::TaskSearchResult` 一致。
 */
export interface TaskSearchResult {
  task: Task;
  projectName: string;
  projectPathExists: boolean;
}

/**
 * 全局搜索结果，按类型分组。已删除 / 无效关联的记录不会出现在结果中。
 * 与 Rust 后端 `search::SearchResults` 一致。
 */
export interface SearchResults {
  /** 归一化后的查询词。 */
  query: string;
  projects: Project[];
  tasks: TaskSearchResult[];
  sessions: WorkspaceSession[];
}

/** 上一次恢复结果。与 Rust 后端 `workspace::RestoreStatus` 一致。 */
export type RestoreStatus = "success" | "failed";

/**
 * 一条工作上下文记录。字段与 Rust 后端 `workspace::WorkspaceSession` 一致。
 * 关联的项目 / 工具 / 任务被删除后，对应 id 为 null，记录本身仍保留。
 */
export interface WorkspaceSession {
  id: string;
  projectId: string;
  /** 项目名称；项目记录已不存在时为 null。 */
  projectName: string | null;
  /** 项目目录当前是否存在且为目录（查询时即时计算）。 */
  projectPathExists: boolean;
  toolId: string | null;
  toolName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  label: string | null;
  restoreLevel: RestoreLevel;
  createdAt: string;
  updatedAt: string;
  /** 最近一次恢复时间；从未恢复过时为 null。 */
  lastUsedAt: string | null;
  lastRestoreStatus: RestoreStatus | null;
  /** 经过脱敏的简短失败原因；成功或尚未恢复时为 null。 */
  lastRestoreError: string | null;
}

/** 创建 / 编辑工作上下文的输入。 */
export interface WorkspaceSessionInput {
  projectId: string;
  toolId?: string | null;
  taskId?: string | null;
  label?: string | null;
}

/** 一次成功恢复的结果。 */
export interface RestoreOutcome {
  session: WorkspaceSession;
  launch: LaunchResult;
}

/** 某项原生会话能力的支持程度。与 Rust 后端 `native::Support` 一致。 */
export type NativeSupport = "supported" | "unsupported" | "notVerified";

/** 历史会话的数据来源类型。与 Rust 后端 `native::history::HistorySourceKind` 一致。 */
export type HistorySourceKind =
  | "service"
  | "transcriptFile"
  | "sessionDatabase"
  | "memorySummary"
  | "none";

/** 记录相对「完整原生会话」的完整度。 */
export type HistoryCompleteness =
  | "fullNative"
  | "metadataOnly"
  | "summaryOnly"
  | "none";

/**
 * 一次历史查询的数据源状态。与 Rust 后端 `native::history::HistoryQueryState` 一致。
 * 刻意区分「有历史 / 没有历史 / 来源不存在 / 无法读取 / 结构不受支持」。
 */
export type HistoryQueryState =
  | "available"
  | "sourceMissing"
  | "unreadable"
  | "structureUnsupported";

/** 历史会话来源的结构化说明（面向用户如实交代来源与限制）。 */
export interface HistorySource {
  kind: HistorySourceKind;
  completeness: HistoryCompleteness;
  /** 是否能取得稳定的原生会话标识。 */
  stableNativeId: boolean;
  /** 我们是否读取完整消息记录（本应用一律不读取对话正文）。 */
  readsMessages: boolean;
  /** 是否支持恢复到工具中的指定会话。 */
  canRestore: boolean;
  /** 来源的一句话说明。 */
  summary: string;
  /** 已知限制。 */
  limitations: string;
}

/**
 * 一款工具的原生会话能力矩阵。与 Rust 后端 `native::SessionCapabilities` 一致。
 * 未核实（`notVerified`）的能力绝不能被当作支持。
 */
export interface NativeSessionCapabilities {
  toolId: string;
  create: NativeSupport;
  list: NativeSupport;
  restore: NativeSupport;
  /** 工具是否公开提供可用于定位会话的原生标识。 */
  nativeId: NativeSupport;
  renameTitle: NativeSupport;
  /** 是否可删除指定的原生会话（不是清空整个会话存储）。 */
  delete: NativeSupport;
  /** 历史会话的数据来源与限制（结构化）。 */
  history: HistorySource;
  /** 能力的核实依据与已知限制。 */
  notes: string;
}

/**
 * 原生会话同步结果：数据源状态 + 同步后的本地会话列表。
 * 与 Rust 后端 `native::SyncOutcome` 一致。
 */
export interface NativeSyncOutcome {
  state: HistoryQueryState;
  sessions: AiSession[];
}

/** 工具中的一条原生会话的公开信息（不含任何对话内容）。 */
export interface NativeSessionInfo {
  nativeId: string;
  title: string | null;
  directory: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * 一条「项目 × 工具」关联记录。与 Rust 后端 `project_tools::ProjectTool` 一致。
 * 它是会话的归属容器：同一项目下不同工具的会话相互独立。
 */
export interface ProjectTool {
  id: string;
  projectId: string;
  toolId: string;
  createdAt: string;
  updatedAt: string;
  /** 查询时即时计算：该关联下的会话数量（含已归档）。 */
  sessionCount: number;
}

/** 会话状态。与 Rust 后端 `sessions::SessionStatus` 一致。 */
export type AiSessionStatus = "active" | "archived";

/** AI 工具会话记录。与 Rust 后端 `sessions::Session` 一致。 */
export interface AiSession {
  id: string;
  projectToolId: string;
  /** 由所属关联派生，便于按项目 / 工具过滤与展示。 */
  projectId: string;
  /** 工具安装 id（`tool_installations.id`）。 */
  toolId: string;
  projectName: string | null;
  toolName: string | null;
  /** 显示名称；由 VibeAcross 管理，允许重复。 */
  displayName: string;
  /** 工具公开提供的原生会话标识；工具未提供时为 null。 */
  nativeSessionId: string | null;
  workingDirectory: string | null;
  status: AiSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  /** 查询时即时计算：所属项目目录当前是否存在且为目录。 */
  projectPathExists: boolean;
}

/** 创建原生会话的输入。 */
export interface NativeCreateInput {
  projectId: string;
  /** 工具安装 id（`tool_installations.id`）。 */
  toolId: string;
  /** 显示名称 / 原生标题；为空时由工具自动生成。 */
  displayName?: string | null;
  /** 创建成功后是否立即在工具中打开（默认 true）。 */
  launch?: boolean;
}

/**
 * 创建原生会话的结果。会话记录已保存，但启动可能单独失败（如实报告）。
 * 与 Rust 后端 `native::NativeCreateOutcome` 一致。
 */
export interface NativeCreateOutcome {
  session: AiSession;
  native: NativeSessionInfo;
  launch: LaunchResult | null;
  /** 启动失败时的后端错误；成功或未请求启动时为 null。 */
  launchError: { code: string; message: string } | null;
}

/** 重命名结果：是否同时修改了原生标题。 */
export interface AiRenameOutcome {
  session: AiSession;
  /** 是否真的同步修改了工具中的原生标题。 */
  nativeRenamed: boolean;
}

/**
 * 会话删除范围：仅删除本地记录 / 仅删除原生会话 / 两者都删。
 * 与 Rust 后端 `native::DeleteScope` 一致。
 */
export type DeleteScope = "local" | "native" | "both";

/**
 * 删除会话的结果。与 Rust 后端 `native::DeleteOutcome` 一致。
 * 如实反映本次实际删除的范围，不虚报成功。
 */
export interface SessionDeleteOutcome {
  scope: DeleteScope;
  /** 原生会话是否已删除（仅当范围包含原生删除时可能为真）。 */
  nativeDeleted: boolean;
  /** 删除前工具中就已不存在该原生会话（此前已在外部被删除）。 */
  nativeAlreadyGone: boolean;
  /** VibeAcross 本地记录是否已清理。 */
  localDeleted: boolean;
}

/** 备份中记录的数据规模。与 Rust 后端 `backup::BackupCounts` 一致。 */
export interface BackupCounts {
  projects: number;
  tasks: number;
  toolInstallations: number;
  workspaceSessions: number;
  settings: number;
}

/** 备份文件（或刚创建的备份）的描述。 */
export interface BackupInfo {
  path: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  schemaVersion: number;
  counts: BackupCounts;
}

/** 恢复操作的结果。 */
export interface BackupRestoreResult {
  sourcePath: string;
  /** 恢复前为当前数据创建的保护性备份路径，可用于手动回退。 */
  protectiveBackupPath: string;
  schemaVersion: number;
  counts: BackupCounts;
}

