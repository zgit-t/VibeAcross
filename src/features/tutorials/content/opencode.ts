import { l, type Tutorial } from "../types";

/** OpenCode（开源终端 AI 编程代理）教程。 */
export const opencodeTutorial: Tutorial = {
  toolId: "opencode",
  toolName: "OpenCode",
  vendor: "OpenCode",
  summary: l(
    "开源终端 AI 编程代理，支持多种模型提供商，可连接已有订阅。",
    "An open-source terminal AI coding agent supporting many model providers and existing subscriptions.",
  ),
  sections: [
    {
      id: "official",
      title: l("官方信息与下载安装", "Official info & installation"),
      blocks: [
        {
          kind: "paragraph",
          text: l(
            "OpenCode 是开源的终端 AI 编程代理，支持通过多种提供商连接模型，也可使用内置的免费模型。",
            "OpenCode is an open-source terminal AI coding agent. It connects to models from many providers and also offers built-in free models.",
          ),
        },
        {
          kind: "bullets",
          items: [
            l("供应商：OpenCode（开源）", "Vendor: OpenCode (open source)"),
            l(
              "形态：命令行工具（CLI），另有桌面应用",
              "Form factor: command-line tool (CLI), plus a desktop app",
            ),
            l("官方网站：opencode.ai", "Official website: opencode.ai"),
            l(
              "官方文档：opencode.ai/docs",
              "Official docs: opencode.ai/docs",
            ),
          ],
        },
        {
          kind: "links",
          links: [
            {
              kind: "home",
              label: l("官方网站", "Official website"),
              url: "https://opencode.ai/",
              host: "opencode.ai",
              note: l("产品介绍与入口。", "Product overview and entry."),
            },
            {
              kind: "docs",
              label: l("官方文档", "Official documentation"),
              url: "https://opencode.ai/docs",
              host: "opencode.ai",
              note: l(
                "含各平台的安装方式与使用说明。",
                "Includes per-platform installation and usage.",
              ),
            },
          ],
        },
        {
          kind: "steps",
          items: [
            l(
              "通用安装脚本：curl -fsSL https://opencode.ai/install | bash",
              "Generic installer: curl -fsSL https://opencode.ai/install | bash",
            ),
            l(
              "Windows 可用包管理器安装：choco install opencode（或 scoop install opencode）。",
              "On Windows you can use a package manager: choco install opencode (or scoop install opencode).",
            ),
            l(
              "也可通过 npm 安装：npm install -g opencode-ai",
              "You can also install via npm: npm install -g opencode-ai",
            ),
            l(
              "安装后运行 opencode 启动，opencode --version 可验证。",
              "Run opencode to start; opencode --version verifies the install.",
            ),
          ],
        },
        {
          kind: "note",
          tone: "info",
          text: l(
            "官方在 Windows 上推荐使用 WSL 以获得更好的兼容性；若使用包管理器或 npm，请以官方文档列出的当前方式为准。",
            "OpenCode recommends WSL on Windows for best compatibility. If using a package manager or npm, follow the current methods listed in the official docs.",
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
              "在项目目录内运行 opencode，按提示连接模型提供商。",
              "Run opencode inside your project directory and connect a model provider when prompted.",
            ),
            l(
              "可使用内置免费模型，或连接 Claude、GPT 等已有订阅 / API Key。",
              "Use the built-in free models, or connect existing subscriptions / API keys such as Claude or GPT.",
            ),
            l(
              "首次在项目中运行后，可让 OpenCode 生成 AGENTS.md 以理解项目结构。",
              "On first run in a project, you can let OpenCode create an AGENTS.md so it understands the project structure.",
            ),
          ],
        },
        {
          kind: "note",
          tone: "info",
          text: l(
            "模型提供商的登录与计费由各自决定，请以官方文档为准。本应用不会存储你的 API Key 或令牌。",
            "Provider sign-in and billing are set by each provider. VibeAcross never stores your API keys or tokens.",
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
            "OpenCode CLI 是命令行工具。VibeAcross 通过「以项目目录为工作目录」的方式启动它，不注入额外参数。",
            "OpenCode CLI is a CLI tool. VibeAcross launches it with the project directory as the working directory and injects no extra arguments.",
          ),
        },
        {
          kind: "steps",
          items: [
            l(
              "在「工具」页点击「检测」自动扫描 PATH 命令与常见安装目录。",
              "Click Detect on the Tools page to scan PATH commands and common install directories.",
            ),
            l(
              "若未检测到，用「手动配置」填写命令名（opencode）或可执行文件路径。",
              "If not detected, use Configure manually to enter the command name (opencode) or the executable path.",
            ),
            l(
              "按需「设为默认工具」，即可从项目页以该项目为工作目录启动。",
              "Optionally Set as default to launch from the Projects page with that project as the working directory.",
            ),
          ],
        },
        {
          kind: "bullets",
          items: [
            l(
              "VibeAcross 支持：自动检测、手动配置路径 / 命令、设为默认工具、以项目目录为工作目录受控启动、按原生会话创建与恢复（工具已公开稳定接口时）。",
              "VibeAcross supports: auto-detection, manual path/command configuration, set as default, controlled launch using the project folder as the working directory, and native session creation / restore when the tool exposes a stable interface.",
            ),
            l(
              "取决于 OpenCode 本身：模型连接、对话内容与产品内功能。",
              "Depends on OpenCode itself: model connections, conversation content and in-product features.",
            ),
            l(
              "历史会话的可用能力以「工具」页与「会话」页实时显示的支持情况为准。",
              "The available historical-session features are shown live on the Tools and Sessions pages.",
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
            "安装后检测不到 OpenCode 怎么办？",
            "OpenCode is not detected after installation. What now?",
          ),
          answer: l(
            "先运行 opencode --version 确认命令可用。若检测不到，请在「工具」页用「手动配置」填写命令名 opencode 或可执行文件的完整路径。",
            "Run opencode --version to confirm the command works. If it is not detected, use Configure manually with the command opencode or the full executable path.",
          ),
        },
        {
          id: "wsl",
          question: l(
            "需要 WSL 才能用吗？",
            "Do I need WSL?",
          ),
          answer: l(
            "不是必须。官方在 Windows 上推荐 WSL 以获得更好的兼容性，但也提供了原生 Windows 的安装方式，具体以官方文档为准。",
            "No. OpenCode recommends WSL on Windows for better compatibility, but native Windows installation is also available; see the official docs.",
          ),
        },
        {
          id: "launch-failed",
          question: l(
            "启动失败怎么办？",
            "Launching fails. What now?",
          ),
          answer: l(
            "确认命令可运行、项目目录存在。若在 WSL 内安装，请注意 Windows 与 WSL 的 PATH 与目录路径差异。",
            "Confirm the command runs and the project directory exists. If installed inside WSL, mind the PATH and directory-path differences between Windows and WSL.",
          ),
        },
        {
          id: "no-session",
          question: l(
            "为什么「按会话恢复」不可用？",
            "Why is \"restore by session\" unavailable?",
          ),
          answer: l(
            "只有当工具公开稳定接口且已在本地核实后，才会提供会话创建 / 恢复。未核实的能力不会被当作支持。",
            "Session creation / restore is offered only after the tool exposes a stable interface that is verified locally. Unverified capabilities are never treated as supported.",
          ),
        },
      ],
    },
  ],
};
