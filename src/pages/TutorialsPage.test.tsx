import { useEffect } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AppProvider, useApp } from "../context/AppContext";
import { I18nProvider } from "../i18n";
import { firstTutorialToolId, getTutorial } from "../features/tutorials/tutorials";
import { localizeText } from "../features/tutorials/types";
import { TutorialsPage } from "./TutorialsPage";

/** 取默认教程某章节（按稳定 id）在当前语言下的标题。 */
function sectionTitle(sectionId: string, locale: "zh-CN" | "en-US"): string {
  const tutorial = getTutorial(firstTutorialToolId());
  const section = tutorial?.sections.find((item) => item.id === sectionId);
  if (!section) {
    throw new Error(`缺少章节：${sectionId}`);
  }
  return localizeText(section.title, locale);
}

/**
 * 覆写元素的 getBoundingClientRect，模拟「不在可视区域内」的布局，
 * 用于验证列表会按滚动容器实际可视区调整 scrollTop。jsdom 没有真实布局，
 * 只有这样才能真实验证滚动定位计算。
 */
function mockRect(element: Element, top: number, bottom: number) {
  element.getBoundingClientRect = (() =>
    ({ top, bottom })) as unknown as Element["getBoundingClientRect"];
}

function renderTutorials() {
  return render(
    <AppProvider>
      <I18nProvider>
        <TutorialsPage />
      </I18nProvider>
    </AppProvider>,
  );
}

/** 模拟从工具卡片发起的教程深链。 */
function DeepLinkTarget({
  toolId,
  name,
  anchor,
}: {
  toolId: string;
  name: string;
  anchor?: string | null;
}) {
  const { openTutorial } = useApp();
  useEffect(() => {
    openTutorial(toolId, name, anchor);
  }, [anchor, name, openTutorial, toolId]);
  return <TutorialsPage />;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("TutorialsPage 教程中心", () => {
  it("默认展示工具目录与第一篇教程", async () => {
    renderTutorials();

    expect(
      await screen.findByRole("heading", { name: "教程中心" }),
    ).toBeInTheDocument();

    const toc = screen.getByRole("navigation", { name: "工具教程目录" });
    expect(within(toc).getByRole("button", { name: /Trae/ })).toBeInTheDocument();
    expect(
      within(toc).getByRole("button", { name: /Cursor/ }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: "Trae", level: 2 }),
    ).toBeInTheDocument();
  });

  it("左侧同时展示工具目录与章节目录，默认高亮首章节", async () => {
    renderTutorials();

    // 顶部标题与搜索框仍在原位。
    expect(
      await screen.findByRole("heading", { name: "教程中心" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "搜索教程" }),
    ).toBeInTheDocument();

    const toolNav = screen.getByRole("navigation", {
      name: "工具教程目录",
    });
    const sectionNav = screen.getByRole("navigation", { name: "章节" });
    expect(toolNav).toBeInTheDocument();
    expect(sectionNav).toBeInTheDocument();

    // 两个卡片：工具卡片在上、章节卡片在下，彼此独立。
    const toolCard = toolNav.parentElement as HTMLElement;
    const sectionCard = sectionNav.parentElement as HTMLElement;
    expect(toolCard).not.toBe(sectionCard);
    expect(toolNav.contains(sectionNav)).toBe(false);
    expect(sectionNav.contains(toolNav)).toBe(false);
    expect(
      toolCard.compareDocumentPosition(sectionCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // 章节卡片标题位于滚动列表之外（滚动章节列表不会让标题消失）。
    const sectionHeader = screen.getByRole("heading", {
      name: "Trae",
      level: 3,
    });
    expect(sectionCard.contains(sectionHeader)).toBe(true);
    expect(sectionNav.contains(sectionHeader)).toBe(false);

    // 章节目录按教程结构渲染四个稳定章节，并默认高亮首章节。
    const items = within(sectionNav).getAllByRole("button");
    expect(items.map((item) => item.textContent)).toEqual([
      sectionTitle("official", "zh-CN"),
      sectionTitle("setup", "zh-CN"),
      sectionTitle("integrate", "zh-CN"),
      sectionTitle("faq", "zh-CN"),
    ]);
    expect(
      within(sectionNav).getByRole("button", {
        name: sectionTitle("official", "zh-CN"),
      }),
    ).toHaveAttribute("aria-current", "true");

    // 章节项带 title 属性，长名称可用原生提示查看完整标题。
    for (const item of items) {
      expect(item).toHaveAttribute("title");
      expect(item.getAttribute("title")).not.toBe("");
    }
  });

  it("点击章节目录定位到对应章节并高亮当前项", async () => {
    renderTutorials();
    const sectionNav = await screen.findByRole("navigation", { name: "章节" });

    const officialItem = within(sectionNav).getByRole("button", {
      name: sectionTitle("official", "zh-CN"),
    });
    const setupItem = within(sectionNav).getByRole("button", {
      name: sectionTitle("setup", "zh-CN"),
    });

    fireEvent.click(setupItem);

    await waitFor(() => {
      expect(
        document.querySelector('[data-anchor="setup"][data-highlighted="true"]'),
      ).not.toBeNull();
    });
    expect(setupItem).toHaveAttribute("aria-current", "true");
    expect(officialItem).not.toHaveAttribute("aria-current");
  });

  it("搜索跳转后左侧工具、章节高亮与右侧正文保持一致", async () => {
    renderTutorials();
    const input = await screen.findByRole("searchbox", { name: "搜索教程" });

    fireEvent.change(input, { target: { value: "初始配置" } });

    const results = await screen.findByRole("region", {
      name: "教程搜索结果",
    });
    fireEvent.click(within(results).getAllByRole("button")[0]);

    const toolNav = await screen.findByRole("navigation", {
      name: "工具教程目录",
    });
    const sectionNav = screen.getByRole("navigation", { name: "章节" });

    // 左侧：工具选中、章节卡片标题与正文所属工具一致、命中章节高亮。
    expect(
      within(toolNav).getByRole("button", { name: /Trae/ }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("heading", { name: "Trae", level: 3 }),
    ).toBeInTheDocument();
    expect(
      within(sectionNav).getByRole("button", {
        name: sectionTitle("setup", "zh-CN"),
      }),
    ).toHaveAttribute("aria-current", "true");

    // 右侧：正文定位到命中章节并保留临时高亮。
    await waitFor(() => {
      expect(
        document.querySelector('[data-anchor="setup"][data-highlighted="true"]'),
      ).not.toBeNull();
    });
  });

  it("工具不在可视区域内时，选中后工具列表内部滚动使其完整可见", async () => {
    renderTutorials();
    const toolNav = await screen.findByRole("navigation", {
      name: "工具教程目录",
    });
    const sectionNav = screen.getByRole("navigation", { name: "章节" });

    mockRect(toolNav, 0, 100);
    const cursor = within(toolNav).getByRole("button", { name: /Cursor/ });
    mockRect(cursor, 260, 300);

    fireEvent.click(cursor);

    // 仅工具列表内部滚动（底部超出 200px），其它容器不动。
    await waitFor(() => expect(toolNav.scrollTop).toBe(200));
    expect(sectionNav.scrollTop).toBe(0);
  });

  it("章节不在可视区域内时，选中后章节列表内部滚动使其完整可见", async () => {
    renderTutorials();
    const toolNav = await screen.findByRole("navigation", {
      name: "工具教程目录",
    });
    const sectionNav = await screen.findByRole("navigation", { name: "章节" });

    mockRect(sectionNav, 0, 80);
    const faq = within(sectionNav).getByRole("button", {
      name: sectionTitle("faq", "zh-CN"),
    });
    mockRect(faq, 200, 230);

    fireEvent.click(faq);

    // 章节列表内部滚动（底部超出 150px），工具列表不受影响。
    await waitFor(() => expect(sectionNav.scrollTop).toBe(150));
    expect(toolNav.scrollTop).toBe(0);
  });

  it("连续点击不同工具的搜索结果时以最后一次为准", async () => {
    renderTutorials();
    const input = await screen.findByRole("searchbox", { name: "搜索教程" });

    // 第一次：命中 Claude Code。
    fireEvent.change(input, { target: { value: "code" } });
    let results = await screen.findByRole("region", {
      name: "教程搜索结果",
    });
    const claudeResult = within(results)
      .getAllByRole("button")
      .find((button) => button.textContent?.includes("Claude Code"));
    expect(claudeResult).toBeDefined();
    fireEvent.click(claudeResult as HTMLElement);
    expect(
      await screen.findByRole("heading", { name: "Claude Code", level: 2 }),
    ).toBeInTheDocument();

    // 第二次：命中 OpenCode Desktop。
    fireEvent.change(input, { target: { value: "code" } });
    results = await screen.findByRole("region", { name: "教程搜索结果" });
    const openCodeResult = within(results)
      .getAllByRole("button")
      .find((button) => button.textContent?.includes("OpenCode Desktop"));
    expect(openCodeResult).toBeDefined();
    fireEvent.click(openCodeResult as HTMLElement);

    // 最终状态只反映最后一次选择，不残留过期跳转。
    expect(
      await screen.findByRole("heading", { name: "OpenCode Desktop", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Claude Code", level: 2 }),
    ).not.toBeInTheDocument();
    const toolNav = screen.getByRole("navigation", { name: "工具教程目录" });
    expect(
      within(toolNav).getByRole("button", { name: /OpenCode Desktop/ }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("heading", { name: "OpenCode Desktop", level: 3 }),
    ).toBeInTheDocument();
  });

  it("切换工具目录可浏览其它工具的教程", async () => {
    renderTutorials();
    const toc = screen.getByRole("navigation", { name: "工具教程目录" });

    fireEvent.click(within(toc).getByRole("button", { name: /Cursor/ }));

    expect(
      await screen.findByRole("heading", { name: "Cursor", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Trae", level: 2 }),
    ).not.toBeInTheDocument();
  });

  it("搜索并点击结果后定位到命中章节并临时高亮", async () => {
    renderTutorials();
    const input = await screen.findByRole("searchbox", {
      name: "搜索教程",
    });

    fireEvent.change(input, { target: { value: "初始配置" } });

    const results = await screen.findByRole("region", {
      name: "教程搜索结果",
    });
    const firstResult = within(results).getAllByRole("button")[0];
    expect(firstResult).toBeDefined();
    fireEvent.click(firstResult);

    // 打开对应教程并回到浏览视图。
    expect(
      await screen.findByRole("heading", { name: "Trae", level: 2 }),
    ).toBeInTheDocument();
    expect(input).toHaveValue("");

    await waitFor(() => {
      expect(
        document.querySelector('[data-anchor="setup"][data-highlighted="true"]'),
      ).not.toBeNull();
    });
  });

  it("无匹配时展示空结果状态", async () => {
    renderTutorials();
    const input = await screen.findByRole("searchbox", { name: "搜索教程" });

    fireEvent.change(input, { target: { value: "zzzz-没有这个词-zzzz" } });

    expect(
      await screen.findByText("没有匹配的教程内容"),
    ).toBeInTheDocument();
    // 结果为空时不再渲染工具目录。
    expect(
      screen.queryByRole("navigation", { name: "工具教程目录" }),
    ).not.toBeInTheDocument();
  });

  it("锚点缺失时回退到教程顶部并给出提示", async () => {
    render(
      <AppProvider>
        <I18nProvider>
          <DeepLinkTarget
            toolId="trae"
            name="Trae"
            anchor="section-does-not-exist"
          />
        </I18nProvider>
      </AppProvider>,
    );

    expect(
      await screen.findByText("未找到目标章节，已回到教程顶部。"),
    ).toBeInTheDocument();
    // 仍展示该工具的教程（回归到顶部而非空白）。
    expect(
      screen.getByRole("heading", { name: "Trae", level: 2 }),
    ).toBeInTheDocument();
  });

  it("深链到无教程的工具时展示无教程状态，且不显示其它工具内容", async () => {
    render(
      <AppProvider>
        <I18nProvider>
          <DeepLinkTarget toolId="my-custom-tool" name="My Custom Tool" />
        </I18nProvider>
      </AppProvider>,
    );

    expect(
      await screen.findByText("暂无该工具的教程"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Trae", level: 2 }),
    ).not.toBeInTheDocument();
  });

  it("英文界面使用英文文案", async () => {
    window.localStorage.setItem("vibeacross.language", "en-US");
    renderTutorials();

    expect(
      await screen.findByRole("heading", { name: "Tutorials" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Search tutorials" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Tool tutorial list" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).toBeInTheDocument();
  });

  it("窄窗口下搜索结果仍完整渲染在结果区内", async () => {
    renderTutorials();
    const input = await screen.findByRole("searchbox", { name: "搜索教程" });

    fireEvent.change(input, { target: { value: "install" } });

    const results = await screen.findByRole("region", {
      name: "教程搜索结果",
    });
    const items = within(results).getAllByRole("button");
    expect(items.length).toBeGreaterThan(0);
    // 每条结果均位于结果区域内，结构不溢出。
    for (const item of items) {
      expect(results.contains(item)).toBe(true);
    }
  });
});
