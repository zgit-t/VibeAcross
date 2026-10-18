import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useI18n } from "../../i18n";
import { openExternalUrl, toErrorMessage } from "../../services/backend";
import { Notice } from "../../components/ui/Notice";
import { faqAnchor, localizeText, type Tutorial } from "./types";
import type { TutorialBlock } from "./types";
import { findScrollContainer, pickTopmostSection } from "./scrollSpy";
import styles from "./TutorialDetail.module.css";

/** 高亮持续时长（毫秒）。 */
const HIGHLIGHT_MS = 2200;

interface TutorialDetailProps {
  tutorial: Tutorial;
  /** 需要定位到的锚点（章节 id 或 `章节id/条目id`）。 */
  focusAnchor: string | null;
  /** 每次请求定位时递增；相同锚点再次请求也能重新触发。 */
  focusToken: number;
  /** 锚点不存在时的回调（上层据此提示并回退到顶部）。 */
  onAnchorMissing: () => void;
  /** 报告当前位于可视带顶部的章节 id（供左侧章节目录高亮）；无匹配时传 null。 */
  onActiveSectionChange?: (sectionId: string | null) => void;
}

/** 一个教程详情：按章节渲染结构化正文，并支持定位到指定锚点。 */
export function TutorialDetail({
  tutorial,
  focusAnchor,
  focusToken,
  onAnchorMissing,
  onActiveSectionChange,
}: TutorialDetailProps) {
  const { t, locale } = useI18n();
  const rootRef = useRef<HTMLElement>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  // 定位：滚动到目标锚点并临时高亮；锚点不存在时回退到顶部并提示。
  useEffect(() => {
    if (!focusAnchor || !rootRef.current) {
      return;
    }
    const nodes = rootRef.current.querySelectorAll<HTMLElement>("[data-anchor]");
    const target = Array.from(nodes).find(
      (node) => node.dataset.anchor === focusAnchor,
    );

    if (!target) {
      rootRef.current.scrollTop = 0;
      onAnchorMissing();
      return;
    }

    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "start" });
    }
    setHighlighted(focusAnchor);
    const timer = window.setTimeout(() => {
      setHighlighted((current) => (current === focusAnchor ? null : current));
    }, HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [focusAnchor, focusToken, tutorial.toolId, onAnchorMissing]);

  // 滚动监听：报告当前位于可视带顶部的章节，供左侧目录高亮；仅在变化时上报，
  // 避免频繁状态更新与闪烁。环境不支持 IntersectionObserver 时静默跳过，
  // 高亮改由点击 / 搜索跳转显式驱动（见 TutorialsPage）。
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") {
      return;
    }
    const sections = Array.from(
      root.querySelectorAll<HTMLElement>("section[data-anchor]"),
    );
    const order = sections
      .map((node) => node.dataset.anchor)
      .filter((id): id is string => Boolean(id));
    if (order.length === 0) {
      return;
    }

    const visible = new Set<string>();
    let lastReported: string | null = null;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.anchor;
          if (!id) {
            continue;
          }
          if (entry.isIntersecting) {
            visible.add(id);
          } else {
            visible.delete(id);
          }
        }
        const next = pickTopmostSection(visible, order);
        if (next !== lastReported) {
          lastReported = next;
          onActiveSectionChange?.(next);
        }
      },
      {
        root: findScrollContainer(root),
        rootMargin: "-96px 0px -55% 0px",
        threshold: 0,
      },
    );
    for (const node of sections) {
      observer.observe(node);
    }
    return () => observer.disconnect();
  }, [tutorial.toolId, onActiveSectionChange]);

  async function handleOpenLink(url: string) {
    setLinkError(null);
    try {
      await openExternalUrl(url);
    } catch (cause) {
      setLinkError(toErrorMessage(cause, t("tutorials.linkOpenFailed")));
    }
  }

  const summary = localizeText(tutorial.summary, locale);

  return (
    <article ref={rootRef} className={styles.detail} aria-label={tutorial.toolName}>
      <header className={styles.header}>
        <p className={styles.vendor}>{tutorial.vendor}</p>
        <h2 className={styles.title}>{tutorial.toolName}</h2>
        <p className={styles.summary}>{summary}</p>
      </header>

      {linkError && (
        <Notice tone="danger" title={t("tutorials.linkOpenFailed")}>
          {linkError}
        </Notice>
      )}

      {tutorial.sections.map((section) => {
        const sectionTitle = localizeText(section.title, locale);
        return (
          <section
            key={section.id}
            id={anchorDomId(tutorial.toolId, section.id)}
            data-anchor={section.id}
            data-highlighted={highlighted === section.id ? "true" : undefined}
            className={styles.section}
            aria-labelledby={`${anchorDomId(tutorial.toolId, section.id)}-title`}
          >
            <h3
              id={`${anchorDomId(tutorial.toolId, section.id)}-title`}
              className={styles.sectionTitle}
            >
              {sectionTitle}
            </h3>

            {section.blocks.map((block, index) => (
              <Block
                key={index}
                block={block}
                onOpenLink={handleOpenLink}
              />
            ))}

            {section.faq && section.faq.length > 0 && (
              <div className={styles.faqList}>
                {section.faq.map((item) => {
                  const anchor = faqAnchor(section.id, item.id);
                  return (
                    <article
                      key={item.id}
                      id={anchorDomId(tutorial.toolId, anchor)}
                      data-anchor={anchor}
                      data-highlighted={
                        highlighted === anchor ? "true" : undefined
                      }
                      className={styles.faqItem}
                    >
                      <h4 className={styles.faqQuestion}>
                        {localizeText(item.question, locale)}
                      </h4>
                      <p className={styles.faqAnswer}>
                        {localizeText(item.answer, locale)}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </article>
  );
}

interface BlockProps {
  block: TutorialBlock;
  onOpenLink: (url: string) => void;
}

function Block({ block, onOpenLink }: BlockProps) {
  const { locale } = useI18n();

  switch (block.kind) {
    case "paragraph":
      return (
        <p className={styles.paragraph}>{localizeText(block.text, locale)}</p>
      );
    case "steps":
      return (
        <ol className={styles.steps}>
          {block.items.map((item, index) => (
            <li key={index}>{localizeText(item, locale)}</li>
          ))}
        </ol>
      );
    case "bullets":
      return (
        <ul className={styles.bullets}>
          {block.items.map((item, index) => (
            <li key={index}>{localizeText(item, locale)}</li>
          ))}
        </ul>
      );
    case "code":
      return (
        <figure className={styles.codeFigure}>
          <figcaption className={styles.codeLabel}>
            {localizeText(block.label, locale)}
          </figcaption>
          <pre className={styles.code}>
            <code>{block.lines.join("\n")}</code>
          </pre>
        </figure>
      );
    case "note":
      return (
        <div className={styles.note}>
          <Notice tone={block.tone === "warning" ? "warning" : "info"}>
            {localizeText(block.text, locale)}
          </Notice>
        </div>
      );
    case "links":
      return (
        <ul className={styles.links}>
          {block.links.map((link) => (
            <li key={link.url} className={styles.linkItem}>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => onOpenLink(link.url)}
                title={link.url}
              >
                <ExternalLink size={14} aria-hidden="true" />
                <span className={styles.linkLabel}>
                  {localizeText(link.label, locale)}
                </span>
                <span className={styles.linkHost}>{link.host}</span>
              </button>
              <span className={styles.linkNote}>
                {localizeText(link.note, locale)}
              </span>
            </li>
          ))}
        </ul>
      );
    default:
      return null;
  }
}

/** 生成稳定的 DOM id，供 aria 关联使用。 */
export function anchorDomId(toolId: string, anchor: string): string {
  const safe = anchor.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return `tutorial-${toolId}-${safe}`;
}

/** 供测试与调用方复用的锚点集合（稳定 id，不依赖标题文本）。 */
export function tutorialAnchorIds(tutorial: Tutorial): string[] {
  const ids: string[] = [];
  for (const section of tutorial.sections) {
    ids.push(section.id);
    for (const item of section.faq ?? []) {
      ids.push(faqAnchor(section.id, item.id));
    }
  }
  return ids;
}

/** 便于测试使用：给定教程的工具 id 生成全部 DOM id。 */
export function useAnchorIds(tutorial: Tutorial): string[] {
  return useMemo(() => tutorialAnchorIds(tutorial), [tutorial]);
}
