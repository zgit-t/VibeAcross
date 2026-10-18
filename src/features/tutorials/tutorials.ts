import { TUTORIALS } from "./content";
import type { Tutorial } from "./types";

export { TUTORIALS };

/** 按内置工具 id 取教程；没有专属教程时返回 null。 */
export function getTutorial(toolId: string): Tutorial | null {
  return TUTORIALS.find((tutorial) => tutorial.toolId === toolId) ?? null;
}

/** 是否存在该工具的专属教程。 */
export function hasTutorial(toolId: string): boolean {
  return TUTORIALS.some((tutorial) => tutorial.toolId === toolId);
}

/** 取第一个教程的工具 id（作为教程中心的默认选中项）。 */
export function firstTutorialToolId(): string {
  return TUTORIALS[0]?.toolId ?? "";
}

export type {
  Tutorial,
  TutorialBlock,
  TutorialFaqItem,
  TutorialLink,
  TutorialSection,
  Localized,
} from "./types";
