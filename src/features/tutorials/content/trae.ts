import { l, type Tutorial } from "../types";

/** Trae（ByteDance AI IDE）教程。 */
export const traeTutorial: Tutorial = {
  toolId: "trae",
  toolName: "Trae",
  vendor: "ByteDance",
  summary: l(
    "面向开发者的 AI 集成开发环境，基于 VS Code 内核，内置 AI 编程与 SOLO 模式。",
    "An AI-integrated development environment for developers, built on the VS Code core with built-in AI coding and SOLO mode.",
  ),
  sections: [
    {
      id: "official",
      title: l("官方信息与下载安装", "Official info & installation"),
      blocks: [
        {
          kind: "paragraph",
          text: l(
            "Trae 由字节跳动（ByteDance）开发，是一款基于 VS Code 内核的 AI 集成开发环境。它同时提供代码编辑器与 AI 编程能力；其中的 SOLO 模式是同一产品内的自主开发工作流。",
            "Trae is an AI IDE from ByteDance built on the VS Code core. It combines a code editor with AI coding; its SOLO mode is an autonomous development workflow within the same product.",
          ),
        },
        {
          kind: "bullets",
          items: [
            l("供应商：字节跳动（ByteDance）", "Vendor: ByteDance"),
            l(
              "形态：桌面应用（Windows 10/11、macOS）",
              "Form factor: desktop app (Windows 10/11, macOS)",
            ),
            l(
              "官方网站：www.trae.ai",
              "Official website: www.trae.ai",
            ),
            l(
              "下载中心：www.trae.ai/download",
              "Download center: www.trae.ai/download",
            ),
            l("官方文档：docs.trae.ai", "Official docs: docs.trae.ai"),
          ],
        },
        {
          kind: "links",
          links: [
            {
              kind: "home",
              label: l("官方网站", "Official website"),
              url: "https://www.trae.ai/",
              host: "www.trae.ai",
              note: l("产品介绍与入口。", "Product overview and entry."),
            },
            {
              kind: "download",
              label: l("官方下载中心", "Official download center"),
              url: "https://www.trae.ai/download",
              host: "www.trae.ai",
              note: l(
                "选择对应平台下载安装包；本应用不从该地址下载或安装。",
                "Download the installer for your platform; VibeAcross does not download or install from here.",
              ),
            },
            {
              kind: "docs",
              label: l("官方文档", "Official documentation"),
              url: "https://docs.trae.ai/",
              host: "docs.trae.ai",
              note: l(
                "安装与使用说明以此处为准。",
                "Use this as the source of truth for installation and usage.",
              ),
            },
          ],
        },
        {
          kind: "steps",
          items: [
            l(
              "打开官方下载中心，选择 Windows (x64) 版本并下载安装包。",
              "Open the official download center, choose Windows (x64) and download the installer.",
            ),
            l(
              "运行安装包，按向导完成安装；安装位置可在向导中修改。",
              "Run the installer and follow the wizard; you may change the install location during setup.",
            ),
            l(
              "安装完成后从开始菜单或桌面快捷方式启动 Trae。",
              "After installation, launch Trae from the Start menu or desktop shortcut.",
            ),
          ],
        },
        {
          kind: "note",
          tone: "warning",
          text: l(
            "请仅从上方官方地址获取安装包。VibeAcross 只负责检测与管理，不会下载或安装任何工具。",
            "Only obtain the installer from the official address above. VibeAcross only detects and manages tools; it never downloads or installs them.",
          ),
        },
      ],
    },
    {
      id: "setup",
      title: l("初始配置", "Initial setup"),
      blocks: [
        {
          kind: "steps",
          items: [
            l(
              "首次启动时按界面引导登录 Trae 账号（支持多种登录方式，以官方页面为准）。",
              "On first launch, sign in to your Trae account following the on-screen guide (available methods are shown on the official page).",
            ),
            l(
              "按需从 VS Code / Cursor 导入已有的设置与扩展，减少迁移成本。",
              "Optionally import your existing settings and extensions from VS Code / Cursor to ease migration.",
            ),
            l(
              "在设置中选择默认模型与 AI 功能开关。",
              "Choose your default model and AI feature toggles in settings.",
            ),
          ],
        },
        {
          kind: "note",
          tone: "info",
          text: l(
            "账号、模型与订阅方案由 Trae 官方决定并可能调整，请以官方文档为准；本应用不代管登录状态或凭据。",
            "Accounts, models and pricing are decided by Trae and may change; refer to the official docs. VibeAcross does not manage your login or credentials.",
          ),
        },
        {
          kind: "bullets",
          items: [
            l(
              "若首次启动未能登录，请检查网络与官方公告。",
              "If sign-in fails on first launch, check your network and official announcements.",
            ),
            l(
              "若扩展或设置未导入成功，可在设置中重新导入。",
              "If extensions or settings did not import, retry the import from settings.",
            ),
          ],
        },
      ],
    },
    {
      id: "integrate",
      title: l("在 VibeAcross 中接入", "Using with VibeAcross"),
      blocks: [
        {
          kind: "paragraph",
          text: l(
            "Trae 是桌面应用。VibeAcross 通过受控启动，把项目目录作为参数打开，让 Trae 直接载入该项目。",
            "Trae is a desktop app. VibeAcross uses controlled launch to open the project folder as an argument so Trae loads that project directly.",
          ),
        },
        {
          kind: "steps",
          items: [
            l(
              "打开「工具」页面，点击「检测」以自动扫描本机已安装的 Trae。",
              "Open the Tools page and click Detect to scan for an installed Trae.",
            ),
            l(
              "若未自动检测到，使用「手动配置」填写 Trae 的可执行文件路径（例如 …\\Trae\\Trae.exe）。",
              "If not auto-detected, use Configure manually to enter Trae's executable path (e.g. …\\Trae\\Trae.exe).",
            ),
            l(
              "在项目上选择该工具，或在工具卡片上「设为默认工具」，即可从项目页直接启动。",
              "Select the tool on a project, or Set as default on the tool card, to launch directly from the Projects page.",
            ),
          ],
        },
        {
          kind: "bullets",
          items: [
            l(
              "VibeAcross 支持：自动检测、手动配置路径、设为默认工具、以项目目录为目标受控启动。",
              "VibeAcross supports: auto-detection, manual path configuration, set as default, and controlled launch targeting the project folder.",
            ),
            l(
              "取决于 Trae 本身：账号登录、模型选择、AI 会话内容与产品内的具体功能。",
              "Depends on Trae itself: account login, model selection, AI session content and in-product features.",
            ),
            l(
              "历史会话的创建与恢复取决于工具是否公开稳定接口；桌面 IDE 通常不提供，请以工具页显示的能力与限制为准。",
              "Creating and restoring historical sessions depends on a stable public interface. Desktop IDEs usually do not provide one; rely on the capabilities shown on the Tools page.",
            ),
          ],
        },
      ],
    },
    {
      id: "faq",
      title: l("常见问题", "FAQ"),
      blocks: [],
      faq: [
        {
          id: "not-detected",
          question: l(
            "安装后 VibeAcross 检测不到 Trae 怎么办？",
            "VibeAcross does not detect Trae after installation. What now?",
          ),
          answer: l(
            "先在 Trae 中确认能正常启动；若安装位置为自定义目录，自动检测可能失败，请在「工具」页使用「手动配置」直接指定可执行文件路径，然后点击「重新验证」。",
            "First confirm Trae launches fine. If you installed it to a custom directory, auto-detection may miss it; use Configure manually on the Tools page to point at the executable, then click Revalidate.",
          ),
        },
        {
          id: "bad-path",
          question: l(
            "可执行文件路径填错了会怎样？",
            "What happens if I enter the wrong executable path?",
          ),
          answer: l(
            "该工具会显示「路径无效」状态，启动会失败。请在「工具」页重新编辑路径，或点击「重新验证」以按当前保存的路径重新校验。",
            "The tool shows an invalid-path status and launching fails. Edit the path again on the Tools page, or click Revalidate to re-check the saved path.",
          ),
        },
        {
          id: "launch-failed",
          question: l(
            "从 VibeAcross 启动 Trae 失败怎么办？",
            "Launching Trae from VibeAcross fails. What now?",
          ),
          answer: l(
            "确认 Trae 能被正常打开、路径指向的是 Trae 的可执行文件。若仍失败，可先在 Trae 内手动打开项目目录作为临时替代。",
            "Make sure Trae opens on its own and the path points at Trae's executable. If it still fails, open the project folder manually inside Trae as a temporary fallback.",
          ),
        },
        {
          id: "no-session",
          question: l(
            "为什么 Trae 没有「历史会话」相关能力？",
            "Why does Trae have no historical-session features?",
          ),
          answer: l(
            "Trae 是桌面 IDE，官方未公开可脚本化调用的会话恢复方式。因此 VibeAcross 只支持「重新打开项目」，不提供按会话恢复。",
            "Trae is a desktop IDE and does not expose a scriptable session-resume mechanism. VibeAcross therefore only supports reopening the project, not restoring by session.",
          ),
        },
      ],
    },
  ],
};
