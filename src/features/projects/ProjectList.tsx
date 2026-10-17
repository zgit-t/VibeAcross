import { useMemo } from "react";
import {
  Clock,
  Copy,
  FolderGit2,
  FolderOpen,
  Info,
  Pencil,
  Play,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import type { Project, ToolEntry } from "../../types/domain";
import { Badge } from "../../components/ui/Badge";
import { IconButton } from "../../components/ui/IconButton";
import { Menu } from "../../components/ui/Menu";
import { useI18n } from "../../i18n";
import { formatDateTime, formatRelativeTime } from "../../utils/format";
import {
  DEFAULT_TOOL_ISSUE_KEY,
  DEFAULT_TOOL_LAUNCH_HINT_KEY,
  resolveDefaultTool,
  toolIsLaunchable,
} from "./health";
import styles from "./ProjectList.module.css";

interface ProjectListProps {
  projects: Project[];
  /** 是否显示「更多操作」菜单。 */
  showActions?: boolean;
  /** 是否显示行内「选择工具 / 启动」控件。 */
  showLaunch?: boolean;
  /** 可用的开发工具列表（用于行内选择与启动）。 */
  tools?: ToolEntry[];
  /** 点击项目主体（查看详情）。 */
  onSelect?: (project: Project) => void;
  onRename?: (project: Project) => void;
  onToggleFavorite?: (project: Project) => void;
  onRemove?: (project: Project) => void;
  /** 在系统文件管理器中打开项目目录。 */
  onOpenDir?: (project: Project) => void;
  /** 复制项目路径到剪贴板。 */
  onCopyPath?: (project: Project) => void;
  /** 设置项目的默认工具（null 表示清除）。 */
  onSetTool?: (project: Project, toolId: string | null) => void;
  /** 打开会话界面（历史会话 + 新建会话），不直接启动工具。 */
  onRun?: (project: Project) => void;
}

/** 项目列表，用于 Overview 与 Projects 页面。 */
export function ProjectList({
  projects,
  showActions = false,
  showLaunch = false,
  tools,
  onSelect,
  onRename,
  onToggleFavorite,
  onRemove,
  onOpenDir,
  onCopyPath,
  onSetTool,
  onRun,
}: ProjectListProps) {
  const { t } = useI18n();
  // 只有「已确认已检测到且可受控启动」的工具才出现在行内快速启动中。
  const launchable = useMemo(
    () => (tools ?? []).filter(toolIsLaunchable),
    [tools],
  );

  const rowClass = showLaunch
    ? `${styles.row} ${styles.rowLaunch}`
    : styles.row;

  return (
    <ul className={styles.list}>
      {projects.map((project) => {
        const defaultInfo = resolveDefaultTool(project.defaultToolId, tools ?? []);
        const knownDefault = defaultInfo.state === "ready";
        const options: Array<{ value: string; label: string }> = [
          { value: "", label: t("projectList.noTool") },
          ...launchable.map((tool) => ({ value: tool.id, label: tool.name })),
        ];
        if (
          project.defaultToolId &&
          defaultInfo.state !== "unset" &&
          defaultInfo.state !== "ready"
        ) {
          options.splice(1, 0, {
            value: project.defaultToolId,
            label: t(DEFAULT_TOOL_ISSUE_KEY[defaultInfo.state]),
          });
        }

        // 未设置默认工具时同样允许进入运行入口，由用户在会话界面中选择工具；
        // 只要存在已识别且可启动的工具即可，不再仅凭默认工具为空判定为不可运行。
        const canLaunch =
          project.pathExists &&
          Boolean(onRun) &&
          (knownDefault || launchable.length > 0);
        const launchHint = !project.pathExists
          ? t("projectList.launchNoDir")
          : defaultInfo.state === "ready"
            ? t("projectList.launch", { name: project.name })
            : defaultInfo.state === "unset"
              ? t("projectList.launchPickTool")
              : t(DEFAULT_TOOL_LAUNCH_HINT_KEY[defaultInfo.state]);

        return (
          <li key={project.id} className={rowClass}>
            <span className={styles.avatar} aria-hidden="true">
              <FolderGit2 size={16} />
            </span>

            <button
              type="button"
              className={styles.main}
              onClick={onSelect ? () => onSelect(project) : undefined}
              disabled={!onSelect}
              aria-label={
                onSelect
                  ? t("projectList.viewDetailAria", { name: project.name })
                  : undefined
              }
            >
              <span className={styles.nameRow}>
                {project.isFavorite && (
                  <Star
                    size={13}
                    className={styles.favoriteStar}
                    aria-label={t("projectList.favorite")}
                  />
                )}
                <span className={styles.name}>{project.name}</span>
                {!project.pathExists && (
                  <Badge
                    tone="warning"
                    icon={<Info size={11} aria-hidden="true" />}
                  >
                    {t("projectList.pathMissing")}
                  </Badge>
                )}
              </span>
              <span
                className={styles.path}
                title={project.path}
                data-selectable="true"
              >
                {project.path}
              </span>
            </button>

            <span
              className={styles.time}
              title={t("projectList.lastOpened", {
                time: formatDateTime(project.lastOpenedAt),
              })}
            >
              <Clock size={13} aria-hidden="true" />
              {formatRelativeTime(project.lastOpenedAt)}
            </span>

            {showLaunch && (
              <span className={styles.tool}>
                <select
                  className={styles.toolSelect}
                  value={project.defaultToolId ?? ""}
                  onChange={(event) =>
                    onSetTool?.(project, event.target.value || null)
                  }
                  disabled={!onSetTool || launchable.length === 0}
                  aria-label={t("projectList.selectToolAria", {
                    name: project.name,
                  })}
                  title={
                    launchable.length === 0
                      ? t("projectList.noLaunchableTool")
                      : t("projectList.selectDefaultTool")
                  }
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <IconButton
                  label={launchHint}
                  size="sm"
                  onClick={() => onRun?.(project)}
                  disabled={!canLaunch}
                >
                  <Play size={14} aria-hidden="true" />
                </IconButton>
              </span>
            )}

            {showActions && (
              <div className={styles.actions}>
                <Menu
                  label={t("projectList.moreActions", { name: project.name })}
                  items={[
                    {
                      label: t("projectList.viewDetail"),
                      icon: <Info size={14} aria-hidden="true" />,
                      disabled: !onSelect,
                      onSelect: () => onSelect?.(project),
                    },
                    {
                      label: t("health.openDir"),
                      icon: <FolderOpen size={14} aria-hidden="true" />,
                      disabled: !onOpenDir || !project.pathExists,
                      disabledHint: t("health.openDirUnavailable"),
                      onSelect: () => onOpenDir?.(project),
                    },
                    {
                      label: t("health.copyPath"),
                      icon: <Copy size={14} aria-hidden="true" />,
                      disabled: !onCopyPath,
                      onSelect: () => onCopyPath?.(project),
                    },
                    {
                      label: t("projectList.rename"),
                      icon: <Pencil size={14} aria-hidden="true" />,
                      disabled: !onRename,
                      onSelect: () => onRename?.(project),
                    },
                    {
                      label: project.isFavorite
                        ? t("projectList.unfavorite")
                        : t("projectList.favoriteAction"),
                      icon: project.isFavorite ? (
                        <StarOff size={14} aria-hidden="true" />
                      ) : (
                        <Star size={14} aria-hidden="true" />
                      ),
                      disabled: !onToggleFavorite,
                      onSelect: () => onToggleFavorite?.(project),
                    },
                    {
                      label: t("projectList.removeProject"),
                      icon: <Trash2 size={14} aria-hidden="true" />,
                      danger: true,
                      disabled: !onRemove,
                      disabledHint: t("projectList.cannotRemove"),
                      onSelect: () => onRemove?.(project),
                    },
                  ]}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
