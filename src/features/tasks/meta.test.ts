import { describe, expect, it } from "vitest";
import { translate } from "../../i18n/translate";
import type { Locale } from "../../i18n/locale";
import {
  getDueState,
  taskPriorityOptions,
  taskSortOptions,
  taskStatusLabel,
  taskStatusOptions,
  TASK_STATUS_ORDER,
} from "./meta";

function makeT(locale: Locale) {
  return (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) =>
    translate(locale, key, vars);
}

describe("任务三态", () => {
  it("状态顺序为 待办 → 进行中 → 已完成", () => {
    expect(TASK_STATUS_ORDER).toEqual(["todo", "inProgress", "done"]);
  });

  it("状态选项包含三态且带本地化标签", () => {
    const options = taskStatusOptions(makeT("zh-CN"));
    expect(options.map((option) => option.value)).toEqual([
      "todo",
      "inProgress",
      "done",
    ]);
    expect(options.map((option) => option.label)).toEqual([
      "待办",
      "进行中",
      "已完成",
    ]);
  });

  it("切换语言后状态标签随之变化", () => {
    expect(taskStatusLabel(makeT("en-US"), "inProgress")).toBe("In progress");
  });

  it("优先级与排序选项基于翻译器构建", () => {
    expect(taskPriorityOptions(makeT("zh-CN")).map((o) => o.value)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(taskSortOptions(makeT("zh-CN")).map((o) => o.value)).toEqual([
      "updated",
      "created",
    ]);
  });
});

describe("getDueState", () => {
  it("无截止日期返回 none", () => {
    expect(getDueState(null, "todo")).toBe("none");
    expect(getDueState("not-a-date", "todo")).toBe("none");
  });

  it("已完成任务不再标记逾期", () => {
    expect(getDueState("2000-01-01", "done")).toBe("upcoming");
  });

  it("过去日期且未完成返回 overdue", () => {
    expect(getDueState("2000-01-01", "todo")).toBe("overdue");
  });
});
