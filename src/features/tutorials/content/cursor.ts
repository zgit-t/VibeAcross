import { l, type Tutorial } from "../types";

/** Cursor（Anysphere AI 代码编辑器）教程。 */
export const cursorTutorial: Tutorial = {
  toolId: "cursor",
  toolName: "Cursor",
  vendor: "Anysphere",
  summary: l(
    "Anysphere 出品的 AI 优先代码编辑器，基于 VS Code 内核。",
    "Anysphere's AI-first code editor, built on the VS Code core.",
  ),
  sections: [
    {
      id: "official",
      title: l("官方信息与下载安装", "Official info & installation"),
      blocks: [
        {
          kind: "paragraph",
          text: l(
            "Cursor 是 Anysphere 出品的 AI 代码编辑器，基于 VS Code 内核，可直接导入 VS Code 的设置与扩展。",
            "Cursor is an AI code editor from Anysphere built on the VS Code core; it can import your VS Code settings and extensions.",
          ),
        },
        {
          kind: "bullets",
          items: [
            l("供应商：Anysphere", "Vendor: Anysphere"),
            l(
              "形态：桌面应用（Windows 10/11、macOS、Linux）",
              "Form factor: desktop app (Windows 10/11, macOS, Linux)",
            ),
            l("官方网站：cursor.com", "Official website: cursor.com"),
            l(
              "下载页面：cursor.com/download",
              "Download page: cursor.com/download",
            ),
            l("官方文档：docs.cursor.com", "Official docs: docs.cursor.com"),
          ],
        },
        {
          kind: "links",
          links: [
            {
              kind: "home",
              label: l("官方网站", "Official website"),
              url: "https://cursor.com/",
              host: "cursor.com",
              note: l("产品介绍与入口。", "Product overview and entry."),
            },
            {
              kind: "download",
              label: l("官方下载页面", "Official download page"),
              url: "https://cursor.com/download",
              host: "cursor.com",
              note: l(
                "下载 Windows (x64) 等平台安装包。",
                "Download the Windows (x64) and other platform installers.",
              ),
            },
            {
              kind: "docs",
              label: l("官方文档", "Official documentation"),
              url: "https://docs.cursor.com/",
              host: "docs.cursor.com",
              note: l("安装与使用说明以此处为准。", "Use this as the source of truth for installation and usage."),
            },
          ],
        },
        {
          kind: "steps",
          items: [
            l(
              "打开官方下载页面，选择 Windows (x64) 版本并下载。",
              "Open the official download page and choose Windows (x64).",
            ),
            l(
              "运行安装程序并按提示完成安装。",
              "Run the installer and follow the prompts.",
            ),
            l(
              "安装后从应用菜单或桌面快捷方式启动 Cursor。",
              "After installation, launch Cursor from the app menu or desktop shortcut.",
            ),
          ],
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
              "首次启动时登录 Cursor 账号（可先在官网注册免费账号）。",
              "Sign in to your Cursor account on first launch (you can sign up free on the website).",
            ),
            l(
              "按需从 VS Code 导入设置与扩展。",
              "Optionally import settings and extensions from VS Code.",
            ),
            l(
              "使用「文件 > 打开文件夹」打开项目目录。",
              "Use File > Open Folder to open a project directory.",
            ),
          ],
        },
        {
          kind: "note",
          tone: "info",
          text: l(
            "账号、模型与订阅要求由 Anysphere 决定，请以官方文档为准。本应用不代管登录或凭据。",
            "Account, models and subscription requirements are set by Anysphere. VibeAcross does not manage logins or credentials.",
          ),
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
            "Cursor 是桌面应用。VibeAcross 通过受控启动，把项目目录作为参数打开，让 Cursor 直接载入该项目。",
            "Cursor is a desktop app. VibeAcross uses controlled launch to open the project folder as an argument so Cursor loads that project directly.",
          ),
        },
        {
          kind: "steps",
          items: [
            l(
              "在「工具」页点击「检测」自动扫描本机已安装的 Cursor。",
              "Click Detect on the Tools page to scan for an installed Cursor.",
            ),
            l(
              "若未检测到，用「手动配置」填写可执行文件路径（例如 …\\cursor\\Cursor.exe）。",
              "If not detected, use Configure manually to enter the executable path (e.g. …\\cursor\\Cursor.exe).",
            ),
            l(
              "按需「设为默认工具」，即可从项目页直接启动。",
              "Optionally Set as default to launch directly from the Projects page.",
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
              "取决于 Cursor 本身：登录、模型、AI 对话与产品内功能。",
              "Depends on Cursor itself: login, models, AI chat and in-product features.",
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
            "安装后检测不到 Cursor 怎么办？",
            "Cursor is not detected after installation. What now?",
          ),
          answer: l(
            "若安装位置为自定义目录，自动检测可能失败。请在「工具」页用「手动配置」指定 Cursor.exe 的完整路径，再点击「重新验证」。",
            "If you installed to a custom directory, auto-detection may miss it. Use Configure manually to point at Cursor.exe, then click Revalidate.",
          ),
        },
        {
          id: "bad-path",
          question: l(
            "路径配置错误怎么处理？",
            "How do I fix a wrong path?",
          ),
          answer: l(
            "工具会显示「路径无效」，启动失败。请重新编辑路径或点击「重新验证」。",
            "The tool shows an invalid-path status and launching fails. Edit the path again or click Revalidate.",
          ),
        },
        {
          id: "launch-failed",
          question: l(
            "从 VibeAcross 启动 Cursor 失败怎么办？",
            "Launching Cursor from VibeAcross fails. What now?",
          ),
          answer: l(
            "确认 Cursor 能独立启动、路径指向 Cursor.exe。若仍失败，可在 Cursor 内手动打开项目目录作为临时替代。",
            "Ensure Cursor opens on its own and the path points at Cursor.exe. If it still fails, open the project folder manually inside Cursor as a fallback.",
          ),
        },
        {
          id: "no-session",
          question: l(
            "为什么 Cursor 没有「历史会话」相关能力？",
            "Why does Cursor have no historical-session features?",
          ),
          answer: l(
            "Cursor 为桌面编辑器，官方未公开 AI 会话恢复命令，因此 VibeAcross 仅支持重新打开项目。",
            "Cursor is a desktop editor without a public AI session-resume command, so VibeAcross only supports reopening the project.",
          ),
        },
      ],
    },
  ],
};
