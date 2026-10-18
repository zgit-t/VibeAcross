import type { Tutorial } from "../types";
import { traeTutorial } from "./trae";
import { traeSoloTutorial } from "./traeSolo";
import { workbuddyTutorial } from "./workbuddy";
import { claudeCodeTutorial } from "./claudeCode";
import { codexCliTutorial } from "./codexCli";
import { cursorTutorial } from "./cursor";
import { opencodeTutorial } from "./opencode";
import { opencodeDesktopTutorial } from "./opencodeDesktop";

/**
 * 全部教程，顺序与 Rust 内置工具目录（`tools/catalog.rs`）保持一致，便于维护。
 * 新增工具时在此追加一个文件并在下方登记即可。
 */
export const TUTORIALS: Tutorial[] = [
  traeTutorial,
  traeSoloTutorial,
  workbuddyTutorial,
  claudeCodeTutorial,
  codexCliTutorial,
  cursorTutorial,
  opencodeTutorial,
  opencodeDesktopTutorial,
];
