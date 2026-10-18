import type { Locale } from "../../i18n/locale";
import { TUTORIALS } from "./tutorials";
import {
  faqAnchor,
  localizeText,
  sectionAnchor,
  sectionBodyText,
  type Tutorial,
} from "./types";

/** 搜索命中的字段类型，用于结果分组与说明。 */
export type TutorialSearchField = "tool" | "title" | "body" | "faq";

/** 一条教程搜索结果，指向具体工具的具体章节（或常见问题条目）。 */
export interface TutorialSearchResult {
  toolId: string;
  toolName: string;
  /** 命中的章节 id（稳定，不依赖标题文本）。 */
  sectionId: string;
  /** 精确定位锚点：章节为章节 id；常见问题为 `章节id/条目id`。 */
  anchor: string;
  sectionTitle: string;
  snippet: string;
  field: TutorialSearchField;
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

/** 以命中位置为中心截取摘要；无命中时截取开头。 */
function makeSnippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const index = flat.toLowerCase().indexOf(query);
  if (index < 0) {
    return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
  }
  const start = Math.max(0, index - 40);
  const end = Math.min(flat.length, index + query.length + 60);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < flat.length ? "…" : "";
  return `${prefix}${flat.slice(start, end).trim()}${suffix}`;
}

/**
 * 在教程数据中搜索。范围覆盖：工具名称、章节标题、正文、常见问题标题与内容，
 * 以及下载 / 安装 / 配置等正文关键词（它们本就属于正文）。
 *
 * - 空关键词返回空数组。
 * - 大小写不敏感。
 * - 每个章节（及其中的每条常见问题）最多产生一条结果，锚点唯一。
 * - 结果顺序跟随教程与章节的定义顺序，保证稳定。
 */
export function searchTutorials(
  query: string,
  locale: Locale,
  tutorials: Tutorial[] = TUTORIALS,
): TutorialSearchResult[] {
  const needle = normalizeQuery(query);
  if (!needle) {
    return [];
  }

  const results: TutorialSearchResult[] = [];

  for (const tutorial of tutorials) {
    const firstSection = tutorial.sections[0];
    const seen = new Set<string>();

    const push = (
      field: TutorialSearchField,
      sectionId: string,
      anchor: string,
      sectionTitle: string,
      snippet: string,
    ) => {
      if (seen.has(anchor)) {
        return;
      }
      seen.add(anchor);
      results.push({
        toolId: tutorial.toolId,
        toolName: tutorial.toolName,
        sectionId,
        anchor,
        sectionTitle,
        snippet,
        field,
      });
    };

    // 工具名称 / 供应商 / 简介命中 → 指向第一个章节。
    const toolText = `${tutorial.toolName} ${tutorial.vendor} ${localizeText(
      tutorial.summary,
      locale,
    )}`;
    if (firstSection && contains(toolText, needle)) {
      push(
        "tool",
        firstSection.id,
        sectionAnchor(firstSection.id),
        localizeText(firstSection.title, locale),
        makeSnippet(localizeText(tutorial.summary, locale), needle),
      );
    }

    for (const section of tutorial.sections) {
      const sectionTitle = localizeText(section.title, locale);
      const body = sectionBodyText(section, locale);

      if (contains(sectionTitle, needle)) {
        push(
          "title",
          section.id,
          sectionAnchor(section.id),
          sectionTitle,
          makeSnippet(sectionTitle, needle),
        );
      } else if (contains(body, needle)) {
        push(
          "body",
          section.id,
          sectionAnchor(section.id),
          sectionTitle,
          makeSnippet(body, needle),
        );
      }

      if (section.faq) {
        for (const item of section.faq) {
          const question = localizeText(item.question, locale);
          const answer = localizeText(item.answer, locale);
          if (contains(question, needle) || contains(answer, needle)) {
            push(
              "faq",
              section.id,
              faqAnchor(section.id, item.id),
              sectionTitle,
              makeSnippet(
                contains(question, needle) ? question : answer,
                needle,
              ),
            );
          }
        }
      }
    }
  }

  return results;
}
