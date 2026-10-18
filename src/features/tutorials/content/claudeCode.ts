import { l, type Tutorial } from "../types";

/** Claude Code（Anthropic 终端 AI 编程代理）教程。 */
export const claudeCodeTutorial: Tutorial = {
  toolId: "claude-code",
  toolName: "Claude Code",
  vendor: "Anthropic",
  summary: l(
    "Anthropic 出品的终端 AI 编程代理，可读取代码仓库、编辑文件并执行命令。",
    "Anthropic's terminal AI coding agent that reads your repository, edits files and runs commands.",
  ),
  sections: [
    {
      id: "official",
      title: l("官方信息与下载安装", "Official info & installation"),
      blocks: [
        {
          kind: "paragraph",
          text: l(
            "Claude Code 是 Anthropic 的命令行 AI 编程代理，在终端中运行，能够读取项目、修改文件与执行命令。",
            "Claude Code is Anthropic's command-line AI coding agent. It runs in your terminal and can read projects, modify files and run commands.",
          ),
        },
        {
          kind: "bullets",
          items: [
            l("供应商：Anthropic", "Vendor: Anthropic"),
            l("形态：命令行工具（CLI）", "Form factor: command-line tool (CLI)"),
            l(
              "产品页：www.anthropic.com/claude-code",
              "Product page: www.anthropic.com/claude-code",
            ),
            l(
              "官方文档：code.claude.com/docs",
              "Official docs: code.claude.com/docs",
            ),
          ],
        },
        {
          kind: "links",
          links: [
            {
              kind: "home",
              label: l("官方产品页", "Official product page"),
              url: "https://www.anthropic.com/claude-code",
              host: "www.anthropic.com",
              note: l("产品介绍与入口。", "Product overview and entry."),
            },
            {
              kind: "docs",
              label: l("安装说明（官方文档）", "Installation (official docs)"),
              url: "https://code.claude.com/docs/en/setup",
              host: "code.claude.com",
              note: l(
                "含 Windows 的原生安装与要求说明。",
                "Includes native Windows installation and requirements.",
              ),
            },
          ],
        },
        {
          kind: "steps",
          items: [
            l(
              "Windows PowerShell 中运行原生安装脚本：irm https://claude.ai/install.ps1 | iex",
              "In Windows PowerShell, run the native installer: irm https://claude.ai/install.ps1 | iex",
            ),
            l(
              "或使用 WinGet 安装：winget install Anthropic.ClaudeCode",
              "Or install with WinGet: winget install Anthropic.ClaudeCode",
            ),
            l(
              "安装完成后打开新的终端窗口，运行 claude --version 验证。",
              "After installation, open a new terminal window and run claude --version to verify.",
            ),
          ],
        },
        {
          kind: "note",
          tone: "info",
          text: l(
            "官方推荐在 Windows 上安装 Git for Windows 以便使用 Bash 工具；未安装时将改用 PowerShell 作为 shell。建议始终以官方文档为准。",
            "Anthropic recommends Git for Windows on native Windows so the Bash tool is available; otherwise it falls back to PowerShell. Always follow the official docs.",
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
              "在项目目录内运行 claude，首次使用按提示完成登录 / 鉴权。",
              "Run claude inside your project directory; complete sign-in / authentication on first use.",
            ),
            l(
              "按需在设置中配置 shell、模型等偏好。",
              "Configure shell, model and other preferences as needed.",
            ),
          ],
        },
        {
          kind: "note",
          tone: "info",
          text: l(
            "登录方式、可用模型与订阅要求由 Anthropic 决定，请以官方文档为准。本应用不代管登录、API Key 或任何凭据。",
            "Sign-in methods, available models and subscription requirements are set by Anthropic. VibeAcross never manages logins, API keys or credentials.",
          ),
        },
        {
          kind: "bullets",
          items: [
            l(
              "若命令找不到，请确认安装目录（例如 %USERPROFILE%\\.local\\bin）已加入 PATH，然后重开终端。",
              "If the command is not found, ensure the install directory (e.g. %USERPROFILE%\\.local\\bin) is on PATH, then reopen the terminal.",
            ),
            l(
              "若出现鉴权报错，请检查是否存在残留的 API Key 环境变量覆盖了登录状态。",
              "For auth errors, check whether a leftover API-key environment variable is overriding your sign-in.",
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
            "Claude Code 是命令行工具。VibeAcross 通过「以项目目录为工作目录」的方式启动它，不注入额外参数。",
            "Claude Code is a CLI tool. VibeAcross launches it with the project directory as the working directory and injects no extra arguments.",
          ),
        },
        {
          kind: "steps",
          items: [
            l(
              "在「工具」页点击「检测」自动扫描 PATH 命令与官方安装目录。",
              "Click Detect on the Tools page to scan PATH commands and official install directories.",
            ),
            l(
              "若未检测到，用「手动配置」填写命令名（claude）或可执行文件路径。",
              "If not detected, use Configure manually to enter the command name (claude) or the executable path.",
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
              "取决于 Claude Code 本身：登录、模型、对话内容与产品内功能。",
              "Depends on Claude Code itself: login, models, conversation content and in-product features.",
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
            "安装后检测不到 Claude Code 怎么办？",
            "Claude Code is not detected after installation. What now?",
          ),
          answer: l(
            "先在新终端里运行 claude --version 确认命令可用；若仍检测不到，请在「工具」页用「手动配置」填写命令名 claude 或可执行文件的完整路径。",
            "First run claude --version in a new terminal to confirm the command works. If it is still not detected, use Configure manually on the Tools page with the command claude or the full executable path.",
          ),
        },
        {
          id: "bad-path",
          question: l(
            "可执行文件路径配置错误怎么处理？",
            "How do I fix a wrong executable path?",
          ),
          answer: l(
            "工具会显示「路径无效」。请重新编辑为正确路径，或点击「重新验证」按当前路径重新校验。",
            "The tool shows an invalid-path status. Edit it to the correct path, or click Revalidate to re-check the saved path.",
          ),
        },
        {
          id: "launch-failed",
          question: l(
            "启动失败或没有进入项目目录怎么办？",
            "Launching fails or it does not enter the project directory. What now?",
          ),
          answer: l(
            "确认项目目录存在、命令可执行。VibeAcross 以项目目录为工作目录启动，请在工具内再确认当前工作目录。",
            "Confirm the project directory exists and the command is runnable. VibeAcross starts it with the project directory as the working directory; verify the working directory inside the tool.",
          ),
        },
        {
          id: "no-session",
          question: l(
            "为什么某些会话能力不可用？",
            "Why are some session features unavailable?",
          ),
          answer: l(
            "会话创建 / 恢复等能力只有在工具公开稳定接口时才提供，且会逐个核实。未核实的接口不会被当作支持，请以应用内显示的能力与限制为准。",
            "Session creation / restore is offered only when the tool exposes a stable interface, verified case by case. Unverified interfaces are never treated as supported; rely on the capabilities shown in the app.",
          ),
        },
      ],
    },
  ],
};
