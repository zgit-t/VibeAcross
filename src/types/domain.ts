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
   * 当前版本恒为 false：只创建进程并定位工作目录，不传递任何会话参数。
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
}

/** 本地数据存储信息。 */
export interface StorageInfo {
  databasePath: string;
  appDataDir: string;
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

