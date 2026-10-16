import { afterEach, describe, expect, it } from "vitest";
import { enUS } from "./en-US";
import {
  DEFAULT_LOCALE,
  getLocale,
  isLocale,
  normalizeLocale,
  setLocale,
  SUPPORTED_LOCALES,
} from "./locale";
import { t, translate } from "./translate";
import type { TranslationKey } from "./translate";
import { zhCN } from "./zh-CN";

afterEach(() => {
  setLocale(DEFAULT_LOCALE);
});

describe("字典完整性", () => {
  it("en-US 与 zh-CN 的键集完全一致", () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it("所有简体中文值非空", () => {
    for (const [key, value] of Object.entries(zhCN)) {
      expect(value, `键 ${key} 的文案为空`).not.toBe("");
    }
  });
});

describe("translate", () => {
  it("按目标语言取值", () => {
    expect(translate("zh-CN", "taskStatus.inProgress")).toBe("进行中");
    expect(translate("en-US", "taskStatus.inProgress")).toBe("In progress");
  });

  it("替换 {name} 形式的变量", () => {
    expect(translate("zh-CN", "taskList.due", { date: "2026-01-01" })).toBe(
      "截止 2026-01-01",
    );
  });

  it("未知键回退为键本身", () => {
    const missing = "does.not.exist" as TranslationKey;
    expect(translate("en-US", missing)).toBe("does.not.exist");
  });

  it("模块级 t 跟随当前语言切换", () => {
    setLocale("en-US");
    expect(t("common.cancel")).toBe("Cancel");
    setLocale("zh-CN");
    expect(t("common.cancel")).toBe("取消");
  });
});

describe("locale 工具", () => {
  it("normalizeLocale 归一化常见标记", () => {
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("zh-Hans")).toBe("zh-CN");
    expect(normalizeLocale("en")).toBe("en-US");
    expect(normalizeLocale("en-US")).toBe("en-US");
  });

  it("normalizeLocale 对未知/空值回退到默认语言", () => {
    expect(normalizeLocale("fr-FR")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("")).toBe(DEFAULT_LOCALE);
  });

  it("isLocale 仅接受受支持的语言", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isLocale(locale)).toBe(true);
    }
    expect(isLocale("ja-JP")).toBe(false);
  });

  it("默认语言为简体中文", () => {
    expect(getLocale()).toBe(DEFAULT_LOCALE);
  });
});
