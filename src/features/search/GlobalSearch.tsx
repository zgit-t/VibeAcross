import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  CornerDownLeft,
  FolderKanban,
  ListChecks,
  RotateCcw,
  Search,
} from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";
import { isDesktopRuntime, notDesktopMessage, toErrorMessage } from "../../services/backend";
import { DEFAULT_SEARCH_LIMIT, globalSearch } from "../../services/search";
import { TASK_STATUS_META } from "../tasks/meta";
import { sessionName } from "../workspace/meta";
import type { Project, SearchResults, WorkspaceSession } from "../../types/domain";
import styles from "./GlobalSearch.module.css";

type ItemKind = "project" | "task" | "session";

interface FlatItem {
  kind: ItemKind;
  id: string;
}

/** 输入停顿后再查询，避免每次按键都触发数据库请求。 */
const DEBOUNCE_MS = 220;

/**
 * 全局搜索入口与结果面板。
 *
 * 触发方式：侧边栏按钮或 `Ctrl/Cmd + K`。结果按「项目 / 任务 / 工作上下文」分组，
 * 支持方向键移动、回车打开；点击结果进入对应详情（项目详情、任务编辑、上下文编辑）。
 * 只读查询后端已有字段，不扫描项目源代码。
 */
export function GlobalSearch() {
  const {
    openProject,
    openTask,
    openSession,
    sidebarCollapsed,
  } = useApp();
  const { t } = useI18n();
  const desktopAvailable = isDesktopRuntime();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Ctrl/Cmd + K 打开 / 关闭。
  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  // 打开时重置状态并聚焦输入框。
  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setResults(null);
    setError(null);
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 防抖查询；空查询不发请求。用请求序号丢弃过期结果，保证结果稳定。
  useEffect(() => {
    const id = ++requestId.current;
    if (!open || !desktopAvailable) {
      return;
    }
    const term = query.trim();
    if (!term) {
      setResults(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      globalSearch(term, DEFAULT_SEARCH_LIMIT)
        .then((response) => {
          if (requestId.current === id) {
            setResults(response);
            setError(null);
          }
        })
        .catch((cause) => {
          if (requestId.current === id) {
            setResults(null);
            setError(toErrorMessage(cause, t("search.failed")));
          }
        })
        .finally(() => {
          if (requestId.current === id) {
            setLoading(false);
          }
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, open, desktopAvailable, t]);

  const items = useMemo<FlatItem[]>(() => {
    if (!results) {
      return [];
    }
    return [
      ...results.projects.map((project) => ({
        kind: "project" as const,
        id: project.id,
      })),
      ...results.tasks.map((entry) => ({
        kind: "task" as const,
        id: entry.task.id,
      })),
      ...results.sessions.map((session) => ({
        kind: "session" as const,
        id: session.id,
      })),
    ];
  }, [results]);

  // 结果集变化后把高亮重置到首项。
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  // 高亮项滚动到可见区域。
  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const close = useCallback(() => setOpen(false), []);

  const activate = useCallback(
    (item: FlatItem) => {
      if (item.kind === "project") {
        openProject(item.id);
      } else if (item.kind === "task") {
        openTask(item.id);
      } else {
        openSession(item.id);
      }
      setOpen(false);
    },
    [openProject, openTask, openSession],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        items.length > 0 ? (index + 1) % items.length : 0,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        items.length > 0 ? (index - 1 + items.length) % items.length : 0,
      );
    } else if (event.key === "Enter") {
      const item = items[activeIndex];
      if (item) {
        event.preventDefault();
        activate(item);
      }
    }
  }

  const term = query.trim();
  const hasQuery = term.length > 0;
  const total = items.length;

  const projectOffset = 0;
  const taskOffset = results?.projects.length ?? 0;
  const sessionOffset = taskOffset + (results?.tasks.length ?? 0);

  function optionId(index: number): string {
    const item = items[index];
    return item ? `global-search-opt-${item.kind}-${item.id}` : "";
  }

  function renderItem(
    index: number,
    className: string,
    onSelect: () => void,
    children: ReactNode,
  ) {
    const active = index === activeIndex;
    return (
      <button
        key={optionId(index)}
        id={optionId(index)}
        type="button"
        role="option"
        aria-selected={active}
        ref={(element) => {
          itemRefs.current[index] = element;
        }}
        className={`${styles.item} ${active ? styles.itemActive : ""} ${className}`}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={onSelect}
      >
        {children}
      </button>
    );
  }

  function renderProject(project: Project, offset: number) {
    return renderItem(
      offset,
      styles.itemProject,
      () => activate({ kind: "project", id: project.id }),
      <>
        <FolderKanban className={styles.itemIcon} size={16} aria-hidden="true" />
        <span className={styles.itemMain}>
          <span className={styles.itemTitle}>{project.name}</span>
          <span className={styles.itemMeta}>{project.path}</span>
        </span>
        {!project.pathExists && (
          <Badge tone="warning">{t("search.pathMissing")}</Badge>
        )}
      </>,
    );
  }

  function renderTask(entry: SearchResults["tasks"][number], offset: number) {
    const meta = TASK_STATUS_META[entry.task.status];
    return renderItem(
      offset,
      styles.itemTask,
      () => activate({ kind: "task", id: entry.task.id }),
      <>
        <ListChecks className={styles.itemIcon} size={16} aria-hidden="true" />
        <span className={styles.itemMain}>
          <span className={styles.itemTitle}>{entry.task.title}</span>
          <span className={styles.itemMeta}>{entry.projectName}</span>
        </span>
        <Badge tone={meta.tone}>{t(meta.labelKey)}</Badge>
      </>,
    );
  }

  function renderSession(session: WorkspaceSession, offset: number) {
    const metaParts = [session.projectName, session.toolName, session.taskTitle]
      .filter((value): value is string => Boolean(value))
      .join(" · ");
    return renderItem(
      offset,
      styles.itemSession,
      () => activate({ kind: "session", id: session.id }),
      <>
        <RotateCcw className={styles.itemIcon} size={16} aria-hidden="true" />
        <span className={styles.itemMain}>
          <span className={styles.itemTitle}>{sessionName(session)}</span>
          <span className={styles.itemMeta}>{metaParts}</span>
        </span>
      </>,
    );
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.trigger} ${
          sidebarCollapsed ? styles.triggerCollapsed : ""
        }`}
        onClick={() => setOpen(true)}
        disabled={!desktopAvailable}
        title={desktopAvailable ? t("search.open") : notDesktopMessage()}
      >
        <Search size={17} className={styles.triggerIcon} aria-hidden="true" />
        <span className={styles.triggerLabel}>{t("search.open")}</span>
        <kbd className={styles.triggerKbd}>Ctrl K</kbd>
      </button>

      <Modal
        open={open}
        onClose={close}
        title={t("search.title")}
        description={t("search.description")}
        size="lg"
      >
        <div className={styles.panel}>
          <div className={styles.inputRow}>
            <Search className={styles.inputIcon} size={16} aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              className={styles.input}
              role="combobox"
              aria-expanded={total > 0}
              aria-controls="global-search-results"
              aria-activedescendant={
                items[activeIndex] ? optionId(activeIndex) : undefined
              }
              aria-label={t("search.placeholder")}
              placeholder={t("search.placeholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div
            id="global-search-results"
            role="listbox"
            aria-label={t("search.resultsAria")}
            className={styles.results}
          >
            {!desktopAvailable ? (
              <Notice tone="warning" title={t("search.notDesktopTitle")}>
                {notDesktopMessage()}
              </Notice>
            ) : error ? (
              <Notice tone="danger" title={t("search.failed")}>
                {error}
              </Notice>
            ) : !hasQuery ? (
              <p className={styles.empty}>{t("search.startHint")}</p>
            ) : loading && !results ? (
              <p className={styles.empty}>{t("common.loading")}</p>
            ) : results && total === 0 ? (
              <p className={styles.empty}>
                {t("search.noResults", { query: term })}
              </p>
            ) : results ? (
              <>
                {results.projects.length > 0 && (
                  <div className={styles.group}>
                    <div className={styles.groupHeader}>
                      <FolderKanban size={13} aria-hidden="true" />
                      <span>{t("search.groupProjects")}</span>
                      <span className={styles.groupCount}>
                        {results.projects.length}
                      </span>
                    </div>
                    {results.projects.map((project, index) =>
                      renderProject(project, projectOffset + index),
                    )}
                  </div>
                )}

                {results.tasks.length > 0 && (
                  <div className={styles.group}>
                    <div className={styles.groupHeader}>
                      <ListChecks size={13} aria-hidden="true" />
                      <span>{t("search.groupTasks")}</span>
                      <span className={styles.groupCount}>
                        {results.tasks.length}
                      </span>
                    </div>
                    {results.tasks.map((entry, index) =>
                      renderTask(entry, taskOffset + index),
                    )}
                  </div>
                )}

                {results.sessions.length > 0 && (
                  <div className={styles.group}>
                    <div className={styles.groupHeader}>
                      <RotateCcw size={13} aria-hidden="true" />
                      <span>{t("search.groupSessions")}</span>
                      <span className={styles.groupCount}>
                        {results.sessions.length}
                      </span>
                    </div>
                    {results.sessions.map((session, index) =>
                      renderSession(session, sessionOffset + index),
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>

          <footer className={styles.footer}>
            <span className={styles.footerHint}>
              <kbd className={styles.kbd}>↑</kbd>
              <kbd className={styles.kbd}>↓</kbd>
              {t("search.hintNavigate")}
            </span>
            <span className={styles.footerHint}>
              <CornerDownLeft size={12} aria-hidden="true" />
              {t("search.hintOpen")}
            </span>
            <span className={`${styles.footerHint} ${styles.scope}`}>
              {t("search.scopeHint")}
            </span>
          </footer>
        </div>
      </Modal>
    </>
  );
}
