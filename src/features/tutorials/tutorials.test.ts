import { describe, expect, it } from "vitest";
import {
  TUTORIALS,
  firstTutorialToolId,
  getTutorial,
  hasTutorial,
} from "./tutorials";
import {
  TUTORIAL_SECTION_IDS,
  faqAnchor,
  localizeText,
  type Localized,
  type Tutorial,
} from "./types";

/** Rust 内置工具目录（`src-tauri/src/tools/catalog.rs`）的定义顺序与 id。 */
const CATALOG_TOOL_IDS = [
  "trae",
  "trae-solo",
  "workbuddy",
  "claude-code",
  "codex-cli",
  "cursor",
  "opencode",
  "opencode-desktop",
];

/**
 * 允许出现的官方域名白名单。教程中的所有外链必须指向官方站点，
 * 以此校验链接归属，而不是依赖实时网络请求。
 */
const OFFICIAL_HOSTS = new Set([
  "www.trae.ai",
  "docs.trae.ai",
  "workbuddy.tencent.com",
  "www.anthropic.com",
  "code.claude.com",
  "developers.openai.com",
  "github.com",
  "cursor.com",
  "docs.cursor.com",
  "opencode.ai",
]);

function eachLocalized(
  tutorial: Tutorial,
  visit: (value: Localized, path: string) => void,
) {
  visit(tutorial.summary, `${tutorial.toolId}.summary`);
  tutorial.sections.forEach((section, sectionIndex) => {
    const base = `${tutorial.toolId}.sections[${sectionIndex}]`;
    visit(section.title, `${base}.title`);
    section.blocks.forEach((block, blockIndex) => {
      const blockPath = `${base}.blocks[${blockIndex}]`;
      switch (block.kind) {
        case "paragraph":
          visit(block.text, `${blockPath}.text`);
          break;
        case "note":
          visit(block.text, `${blockPath}.text`);
          break;
        case "steps":
        case "bullets":
          block.items.forEach((item, itemIndex) =>
            visit(item, `${blockPath}.items[${itemIndex}]`),
          );
          break;
        case "code":
          visit(block.label, `${blockPath}.label`);
          break;
        case "links":
          block.links.forEach((link, linkIndex) => {
            visit(link.label, `${blockPath}.links[${linkIndex}].label`);
            visit(link.note, `${blockPath}.links[${linkIndex}].note`);
          });
          break;
      }
    });
    (section.faq ?? []).forEach((item, itemIndex) => {
      visit(item.question, `${base}.faq[${itemIndex}].question`);
      visit(item.answer, `${base}.faq[${itemIndex}].answer`);
    });
  });
}

describe("教程目录", () => {
  it("覆盖全部内置工具，且顺序与 Rust 工具目录一致", () => {
    expect(TUTORIALS.map((tutorial) => tutorial.toolId)).toEqual(
      CATALOG_TOOL_IDS,
    );
  });

  it("每个工具都有名称、供应商与非空简介", () => {
    for (const tutorial of TUTORIALS) {
      expect(tutorial.toolName.length).toBeGreaterThan(0);
      expect(tutorial.vendor.length).toBeGreaterThan(0);
      expect(localizeText(tutorial.summary, "zh-CN").length).toBeGreaterThan(0);
      expect(localizeText(tutorial.summary, "en-US").length).toBeGreaterThan(0);
    }
  });

  it("查找辅助函数与目录保持一致", () => {
    expect(firstTutorialToolId()).toBe("trae");
    expect(hasTutorial("cursor")).toBe(true);
    expect(getTutorial("cursor")?.toolName).toBe("Cursor");
    expect(hasTutorial("custom-not-builtin")).toBe(false);
    expect(getTutorial("custom-not-builtin")).toBeNull();
  });
});

describe("教程结构", () => {
  it.each(TUTORIALS.map((tutorial) => tutorial.toolId))(
    "%s 含四个必备章节且顺序稳定",
    (toolId) => {
      const tutorial = getTutorial(toolId);
      expect(tutorial).not.toBeNull();
      expect(tutorial?.sections.map((section) => section.id)).toEqual([
        ...TUTORIAL_SECTION_IDS,
      ]);
    },
  );

  it("章节 id 在每个教程内唯一", () => {
    for (const tutorial of TUTORIALS) {
      const ids = tutorial.sections.map((section) => section.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("常见问题条目 id 唯一，且生成唯一锚点", () => {
    for (const tutorial of TUTORIALS) {
      const anchors = new Set<string>();
      for (const section of tutorial.sections) {
        const ids = (section.faq ?? []).map((item) => item.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const item of section.faq ?? []) {
          anchors.add(faqAnchor(section.id, item.id));
        }
      }
      expect(anchors.size).toBe(
        tutorial.sections.reduce(
          (total, section) => total + (section.faq?.length ?? 0),
          0,
        ),
      );
    }
  });

  it("每个工具都提供「常见问题」章节及至少一条问答", () => {
    for (const tutorial of TUTORIALS) {
      const faq = tutorial.sections.find((section) => section.id === "faq");
      expect(faq?.faq?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("双语文案", () => {
  it("所有文案都同时提供非空的简体中文与英文", () => {
    for (const tutorial of TUTORIALS) {
      eachLocalized(tutorial, (value, path) => {
        expect(value["zh-CN"].trim(), `${path} (zh-CN)`).not.toBe("");
        expect(value["en-US"].trim(), `${path} (en-US)`).not.toBe("");
      });
    }
  });

  it("localizeText 按语言取值，缺失时回退简体中文", () => {
    const value: Localized = { "zh-CN": "中文", "en-US": "English" };
    expect(localizeText(value, "zh-CN")).toBe("中文");
    expect(localizeText(value, "en-US")).toBe("English");
  });
});

describe("官方外链", () => {
  it("所有链接为 https 且域名属于官方白名单", () => {
    for (const tutorial of TUTORIALS) {
      for (const section of tutorial.sections) {
        for (const block of section.blocks) {
          if (block.kind !== "links") {
            continue;
          }
          for (const link of block.links) {
            expect(
              link.url.startsWith("https://"),
              `${tutorial.toolId} ${link.url}`,
            ).toBe(true);
            const hostname = new URL(link.url).hostname;
            expect(hostname, `${tutorial.toolId} ${link.url}`).toBe(link.host);
            expect(
              OFFICIAL_HOSTS.has(hostname),
              `${tutorial.toolId} 使用了非白名单域名 ${hostname}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("每个工具都至少提供一个官方入口链接", () => {
    for (const tutorial of TUTORIALS) {
      const links = tutorial.sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.kind === "links")
        .flatMap((block) => (block.kind === "links" ? block.links : []));
      expect(links.length, tutorial.toolId).toBeGreaterThan(0);
    }
  });

  it("教程正文不含疑似密钥或令牌", () => {
    const suspicious = /(sk-[A-Za-z0-9]{16,}|api[_-]?key\s*[:=]\s*\S+)/i;
    for (const tutorial of TUTORIALS) {
      const text = JSON.stringify(tutorial);
      expect(suspicious.test(text), tutorial.toolId).toBe(false);
    }
  });
});
