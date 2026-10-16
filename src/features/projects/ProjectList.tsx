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
import styles from "./ProjectList.module.css";

interface ProjectListProps {
  projects: Project[];
  /** 是否显示「更多操作」菜单。 */
  showActions?: boolean;
  /** 是否显示行内「选择工具 / 启动」控件。 */
  showLaunch?: boolean;
  /** 可用的开发工具列表（用于行内选择与启动）。 */
  tools?: ToolEntry[];
  /** 正在启动中的项目 id，用于禁用重复点击。 */
  launchingId?: string | null;
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
  /** 使用指定工具启动项目。 */
  onLaunch?: (project: Project, toolId: string) => void;
}

/** 项目列表，用于 Overview 与 Projects 页面。 */
export function ProjectList({
  projects,
  showActions = false,
  showLaunch = false,
  tools,
  launchingId,
  onSelect,
  onRename,
  onToggleFavorite,
  onRemove,
  onOpenDir,
  onCopyPath,
  onSetTool,
  onLaunch,
}: ProjectListProps) {
  const { t } = useI18n();
  // 只有「已确认可受控启动」的工具才出现在行内快速启动中。
  const launchable = useMemo(
    () => (tools ?? []).filter((tool) => tool.launch.support === "supported"),
    [tools],
  );

  const rowClass = showLaunch
    ? `${styles.row} ${styles.rowLaunch}`
    : styles.row;

  return (
    <ul className={styles.list}>
      {projects.map((project) => {
        const options: Array<{ value: string; label: string }> = [
          { value: "", label: t("projectList.noTool") },
          ...launchable.map((tool) => ({ value: tool.id, label: tool.name })),
        ];
        const knownDefault =
          project.defaultToolId !== null &&
          launchable.some((tool) => tool.id === project.defaultToolId);
        if (project.defaultToolId && !knownDefault) {
          options.splice(1, 0, {
            value: project.defaultToolId,
            label: t("projectList.defaultUnavailable"),
          });
        }

        const canLaunch =
          Boolean(project.defaultToolId) &&
          knownDefault &&
          project.pathExists &&
          Boolean(onLaunch) &&
          launchingId !== project.id;
        const launchHint = !project.pathExists
          ? t("projectList.launchNoDir")
          : !knownDefault
            ? t("projectList.launchPickTool")
            : t("projectList.launch", { name: project.name });

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
                  onClick={() => {
                    if (project.defaultToolId) {
                      onLaunch?.(project, project.defaultToolId);
                    }
                  }}
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
