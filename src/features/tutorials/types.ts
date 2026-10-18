import type { Locale } from "../../i18n/locale";

/**
 * 教程数据模型。
 *
 * 教程正文与界面语言分离：每种语言各存一份文案（`Localized`），由页面按当前
 * 语言解析。组件只负责渲染结构化数据，不内嵌任何正文，便于新增工具或更新章节。
 */

/** 一段与语言绑定的文案。两种受支持语言都必须提供。 */
export type Localized = Record<Locale, string>;

/** 快速构造一条双语文案，减少数据文件的样板代码。 */
export function l(zh: string, en: string): Localized {
  return { "zh-CN": zh, "en-US": en };
}

/** 解析双语文案为指定语言；语言缺失时回退到简体中文。 */
export function localizeText(value: Localized, locale: Locale): string {
  return value[locale] ?? value["zh-CN"];
}

/** 官方外链用途。 */
export type TutorialLinkKind = "home" | "download" | "docs";

/** 一条经过核实的官方外链。`host` 为该链接的官方域名，用于校验归属。 */
export interface TutorialLink {
  kind: TutorialLinkKind;
  label: Localized;
  /** 完整 https 链接。 */
  url: string;
  /** 期望的域名（`new URL(url).hostname` 必须与其一致）。 */
  host: string;
  /** 该链接的行内说明（用途 / 适用范围）。 */
  note: Localized;
}

/** 教程正文块。章节由若干块按顺序组成。 */
export type TutorialBlock =
  | { kind: "paragraph"; text: Localized }
  | { kind: "steps"; items: Localized[] }
  | { kind: "bullets"; items: Localized[] }
  | { kind: "code"; label: Localized; lines: string[] }
  | { kind: "note"; tone: "info" | "warning"; text: Localized }
  | { kind: "links"; links: TutorialLink[] };

/** 一条常见问题。`id` 在所属教程内稳定且唯一，用于精确定位。 */
export interface TutorialFaqItem {
  id: string;
  question: Localized;
  answer: Localized;
}

/** 一个教程章节。`id` 在所属教程内稳定且唯一，不依赖标题文本。 */
export interface TutorialSection {
  id: string;
  title: Localized;
  blocks: TutorialBlock[];
  /** 「常见问题」章节使用；其余章节为空。 */
  faq?: TutorialFaqItem[];
}

/** 一款工具的完整教程。 */
export interface Tutorial {
  /** 与内置工具定义 id（`ToolEntry.toolId`）一致，用于从工具卡片关联教程。 */
  toolId: string;
  toolName: string;
  vendor: string;
  summary: Localized;
  sections: TutorialSection[];
}

/** 四个必备章节的稳定 id，所有教程必须包含。 */
export const TUTORIAL_SECTION_IDS = [
  "official",
  "setup",
  "integrate",
  "faq",
] as const;

export type TutorialSectionId = (typeof TUTORIAL_SECTION_IDS)[number];

/** 定位锚点：章节为章节 id；常见问题条目为 `章节id/条目id`。 */
export function sectionAnchor(sectionId: string): string {
  return sectionId;
}

export function faqAnchor(sectionId: string, faqId: string): string {
  return `${sectionId}/${faqId}`;
}

// ---------------------------------------------------------------------------
// 结构化字段的纯文本投影：供搜索与摘要使用。
// ---------------------------------------------------------------------------

/** 把一个块投影为纯文本（用于搜索 / 摘要），保持块内顺序。 */
export function blockText(block: TutorialBlock, locale: Locale): string {
  switch (block.kind) {
    case "paragraph":
      return localizeText(block.text, locale);
    case "steps":
    case "bullets":
      return block.items.map((item) => localizeText(item, locale)).join(" ");
    case "code":
      return [
        localizeText(block.label, locale),
        ...block.lines,
      ].join(" ");
    case "note":
      return localizeText(block.text, locale);
    case "links":
      return block.links
        .map(
          (link) =>
            `${localizeText(link.label, locale)} ${link.url} ${localizeText(link.note, locale)}`,
        )
        .join(" ");
    default:
      return "";
  }
}

/** 章节标题之外的全部正文（含常见问题问与答）的纯文本。 */
export function sectionBodyText(
  section: TutorialSection,
  locale: Locale,
): string {
  const parts = section.blocks.map((block) => blockText(block, locale));
  if (section.faq) {
    for (const item of section.faq) {
      parts.push(localizeText(item.question, locale));
      parts.push(localizeText(item.answer, locale));
    }
  }
  return parts.filter((part) => part.trim().length > 0).join("\n");
}
