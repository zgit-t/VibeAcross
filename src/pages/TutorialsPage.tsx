import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, SearchX } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Notice } from "../components/ui/Notice";
import { SearchInput } from "../components/ui/SearchInput";
import {
  TUTORIALS,
  firstTutorialToolId,
  getTutorial,
} from "../features/tutorials/tutorials";
import { searchTutorials } from "../features/tutorials/search";
import { TutorialDetail } from "../features/tutorials/TutorialDetail";
import { scrollNearestItem } from "../features/tutorials/scrollSpy";
import {
  localizeText,
  sectionAnchor,
  type Tutorial,
} from "../features/tutorials/types";
import type { TutorialSearchResult } from "../features/tutorials/search";
import styles from "./TutorialsPage.module.css";

/** 锚点（章节 id 或 `章节id/条目id`）命中的章节 id。 */
function sectionIdOfAnchor(anchor: string | null): string | null {
  return anchor ? anchor.split("/")[0] : null;
}

/**
 * 把（可能失效的）锚点解析为教程中真实存在的章节 id。
 *
 * 找不到时回退到首章节，确保左侧目录高亮与右侧正文不会互相矛盾。
 */
function resolveSectionId(
  tutorial: Tutorial | null,
  anchor: string | null,
): string | null {
  if (!tutorial) {
    return null;
  }
  const candidate = sectionIdOfAnchor(anchor);
  if (
    candidate &&
    tutorial.sections.some((section) => section.id === candidate)
  ) {
    return candidate;
  }
  return tutorial.sections[0]?.id ?? null;
}

/**
 * 教程中心。
 *
 * - 浏览：左侧工具列表 + 右侧教程详情。
 * - 搜索：覆盖工具名称、章节标题、正文、常见问题；结果链接到具体工具与章节。
 * - 深链：从工具卡片进入时定位到对应工具的教程（可选定位到章节并临时高亮）。
 */
export function TutorialsPage() {
  const { pendingTutorial, clearPendingTutorial } = useApp();
  const { t, locale } = useI18n();

  const [query, setQuery] = useState("");
  const [selectedToolId, setSelectedToolId] = useState(firstTutorialToolId);
  const [missingTool, setMissingTool] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [focusAnchor, setFocusAnchor] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [anchorNotice, setAnchorNotice] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(
    () => getTutorial(firstTutorialToolId())?.sections[0]?.id ?? null,
  );

  // 两个左侧卡片各自的内部滚动容器：只在这里滚动，绝不滚动页面。
  const toolListRef = useRef<HTMLElement>(null);
  const sectionListRef = useRef<HTMLElement>(null);

  // 消费来自工具卡片的教程深链。
  useEffect(() => {
    if (!pendingTutorial) {
      return;
    }
    const { toolId, name, anchor } = pendingTutorial;
    const tutorial = getTutorial(toolId);
    if (tutorial) {
      setSelectedToolId(toolId);
      setMissingTool(null);
      setAnchorNotice(null);
      setQuery("");
      setFocusAnchor(anchor);
      setFocusToken((token) => token + 1);
      setActiveSectionId(resolveSectionId(tutorial, anchor));
    } else {
      setMissingTool({ id: toolId, name });
      setQuery("");
      setActiveSectionId(null);
    }
    clearPendingTutorial();
  }, [pendingTutorial, clearPendingTutorial]);

  const trimmedQuery = query.trim();
  const results = useMemo(
    () => searchTutorials(query, locale),
    [query, locale],
  );

  const selectedTutorial = useMemo(
    () => getTutorial(selectedToolId) ?? TUTORIALS[0] ?? null,
    [selectedToolId],
  );

  // 选中工具后，若该选项不在工具列表可视区域内，仅将工具列表内部滚动到它。
  useEffect(() => {
    const container = toolListRef.current;
    if (!container) {
      return;
    }
    const item = Array.from(
      container.querySelectorAll<HTMLElement>("[data-tool-id]"),
    ).find((node) => node.dataset.toolId === selectedToolId);
    scrollNearestItem(container, item ?? null);
  }, [selectedToolId]);

  // 当前章节变化（点击目录 / 搜索跳转 / 滚动监听）后，仅滚动章节列表使目标可见。
  // 依赖 toolId 以便切换工具、章节 id 恰好同名时也能重新定位。
  useEffect(() => {
    const container = sectionListRef.current;
    if (!container) {
      return;
    }
    const item = Array.from(
      container.querySelectorAll<HTMLElement>("[data-section-id]"),
    ).find((node) => node.dataset.sectionId === activeSectionId);
    scrollNearestItem(container, item ?? null);
  }, [activeSectionId, selectedTutorial?.toolId]);

  const selectTool = useCallback((toolId: string) => {
    setSelectedToolId(toolId);
    setMissingTool(null);
    setFocusAnchor(null);
    setAnchorNotice(null);
    setActiveSectionId(getTutorial(toolId)?.sections[0]?.id ?? null);
  }, []);

  const openResult = useCallback((result: TutorialSearchResult) => {
    setQuery("");
    setMissingTool(null);
    setAnchorNotice(null);
    setSelectedToolId(result.toolId);
    setFocusAnchor(result.anchor);
    setFocusToken((token) => token + 1);
    setActiveSectionId(result.sectionId);
  }, []);

  // 点击章节目录：复用搜索跳转同一套定位机制，并立即更新当前章节高亮。
  const goToSection = useCallback((sectionId: string) => {
    setAnchorNotice(null);
    setFocusAnchor(sectionAnchor(sectionId));
    setFocusToken((token) => token + 1);
    setActiveSectionId(sectionId);
  }, []);

  // 滚动监听上报当前章节；相同值不触发更新，避免无谓重渲染。
  const handleActiveSectionChange = useCallback((sectionId: string | null) => {
    setActiveSectionId((prev) => (prev === sectionId ? prev : sectionId));
  }, []);

  const handleAnchorMissing = useCallback(() => {
    setAnchorNotice(t("tutorials.anchorMissing"));
  }, [t]);

  return (
    <div className={styles.page}>
      <PageHeader
        title={t("tutorials.title")}
        description={t("tutorials.description")}
      />

      <div className={styles.toolbar}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("tutorials.searchPlaceholder")}
          label={t("tutorials.searchLabel")}
        />
        {trimmedQuery && (
          <span className={styles.count}>
            {t("tutorials.resultCount", { count: results.length })}
          </span>
        )}
      </div>

      {trimmedQuery ? (
        <div
          className={styles.results}
          role="region"
          aria-label={t("tutorials.resultsLabel")}
        >
          {results.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={t("tutorials.noResultsTitle")}
              description={t("tutorials.noResultsDescription", {
                query: trimmedQuery,
              })}
              action={
                <Button variant="secondary" onClick={() => setQuery("")}>
                  {t("common.clearFilter")}
                </Button>
              }
            />
          ) : (
            <ul className={styles.resultList}>
              {results.map((result) => (
                <li key={`${result.toolId}:${result.anchor}`}>
                  <button
                    type="button"
                    className={styles.resultItem}
                    onClick={() => openResult(result)}
                  >
                    <span className={styles.resultMeta}>
                      <span className={styles.resultTool}>
                        {result.toolName}
                      </span>
                      <span className={styles.resultSection}>
                        {result.sectionTitle}
                      </span>
                    </span>
                    <span className={styles.resultSnippet}>
                      {result.snippet}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : missingTool ? (
        <EmptyState
          icon={BookOpen}
          title={t("tutorials.noneTitle")}
          description={t("tutorials.noneDescription", { name: missingTool.name })}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setMissingTool(null);
                setSelectedToolId(firstTutorialToolId());
              }}
            >
              {t("tutorials.browseOther")}
            </Button>
          }
        />
      ) : (
        <div className={styles.layout}>
          <div className={styles.sideNav}>
            <div className={styles.toolCard}>
              <nav
                className={styles.toolList}
                ref={toolListRef}
                aria-label={t("tutorials.tocLabel")}
              >
                {TUTORIALS.map((tutorial) => {
                  const active = tutorial.toolId === selectedToolId;
                  return (
                    <button
                      key={tutorial.toolId}
                      type="button"
                      data-tool-id={tutorial.toolId}
                      className={`${styles.toolNavItem} ${
                        active ? styles.toolNavActive : ""
                      }`}
                      aria-current={active ? "true" : undefined}
                      onClick={() => selectTool(tutorial.toolId)}
                    >
                      <span className={styles.toolNavName}>
                        {tutorial.toolName}
                      </span>
                      <span className={styles.toolNavVendor}>
                        {tutorial.vendor}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>

            {selectedTutorial && (
              <div className={styles.sectionCard}>
                <h3 className={styles.sectionCardHeader}>
                  {selectedTutorial.toolName}
                </h3>
                <nav
                  className={styles.sectionList}
                  ref={sectionListRef}
                  aria-label={t("tutorials.sectionsLabel")}
                >
                  {selectedTutorial.sections.map((section) => {
                    const title = localizeText(section.title, locale);
                    const active = section.id === activeSectionId;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        data-section-id={section.id}
                        className={`${styles.sectionNavItem} ${
                          active ? styles.sectionNavActive : ""
                        }`}
                        aria-current={active ? "true" : undefined}
                        title={title}
                        onClick={() => goToSection(section.id)}
                      >
                        {title}
                      </button>
                    );
                  })}
                </nav>
              </div>
            )}
          </div>

          <div className={styles.content}>
            {anchorNotice && <Notice tone="warning">{anchorNotice}</Notice>}
            {selectedTutorial && (
              <TutorialDetail
                key={selectedTutorial.toolId}
                tutorial={selectedTutorial}
                focusAnchor={focusAnchor}
                focusToken={focusToken}
                onAnchorMissing={handleAnchorMissing}
                onActiveSectionChange={handleActiveSectionChange}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
