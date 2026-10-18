import { l, type Tutorial } from "../types";

/** OpenAI Codex CLI 教程。 */
export const codexCliTutorial: Tutorial = {
  toolId: "codex-cli",
  toolName: "OpenAI Codex CLI",
  vendor: "OpenAI",
  summary: l(
    "OpenAI 提供的命令行编码代理，在本地终端中运行。",
    "OpenAI's command-line coding agent that runs locally in your terminal.",
  ),
  sections: [
    {
      id: "official",
      title: l("官方信息与下载安装", "Official info & installation"),
      blocks: [
        {
          kind: "paragraph",
          text: l(
            "Codex CLI 是 OpenAI 的命令行编码代理，在本地终端运行。它与编辑器内的 Codex 插件、云端 Codex 是不同的使用形态。",
            "Codex CLI is OpenAI's command-line coding agent that runs locally in your terminal. It is a different form factor from the in-editor Codex extension and the cloud Codex.",
          ),
        },
        {
          kind: "bullets",
          items: [
            l("供应商：OpenAI", "Vendor: OpenAI"),
            l("形态：命令行工具（CLI）", "Form factor: command-line tool (CLI)"),
            l(
              "官方文档：developers.openai.com/codex/cli",
              "Official docs: developers.openai.com/codex/cli",
            ),
            l(
              "官方源码仓库：github.com/openai/codex",
              "Official source repository: github.com/openai/codex",
            ),
          ],
        },
        {
          kind: "links",
          links: [
            {
              kind: "docs",
              label: l("官方 CLI 文档", "Official CLI documentation"),
              url: "https://developers.openai.com/codex/cli",
              host: "developers.openai.com",
              note: l("安装与使用说明以此处为准。", "Use this as the source of truth for installation and usage."),
            },
            {
              kind: "home",
              label: l("官方源码仓库", "Official source repository"),
              url: "https://github.com/openai/codex",
              host: "github.com",
              note: l(
                "OpenAI 官方在 GitHub 上的仓库，含发布包与说明。",
                "OpenAI's official GitHub repository, including releases and docs.",
              ),
            },
          ],
        },
        {
          kind: "steps",
          items: [
            l(
              "Windows PowerShell 中运行官方安装脚本：powershell -ExecutionPolicy ByPass -c \"irm https://chatgpt.com/codex/install.ps1 | iex\"",
              "In Windows PowerShell, run the official installer: powershell -ExecutionPolicy ByPass -c \"irm https://chatgpt.com/codex/install.ps1 | iex\"",
            ),
            l(
              "或通过 npm 安装：npm install -g @openai/codex",
              "Or install via npm: npm install -g @openai/codex",
            ),
            l(
              "安装完成后运行 codex 即可开始，使用 codex --version 可验证版本。",
              "After installation run codex to start; codex --version verifies the install.",
            ),
          ],
        },
        {
          kind: "note",
          tone: "warning",
          text: l(
            "请只使用官方安装脚本或官方 npm 包。不要从非官方来源获取所谓的「加速版」安装包。",
            "Use only the official installer or the official npm package. Do not obtain so-called \"mirror\" installers from unofficial sources.",
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
              "在项目目录内运行 codex，按提示选择登录方式（可使用 ChatGPT 账号或 API Key）。",
              "Run codex inside your project directory and choose a sign-in method (ChatGPT account or API key).",
            ),
            l(
              "按需在配置中设置默认模型等偏好。",
              "Set preferences such as the default model as needed.",
            ),
          ],
        },
        {
          kind: "note",
          tone: "info",
          text: l(
            "登录方式、模型可用性与计费由 OpenAI 决定，请以官方文档为准。本应用不会存储你的 API Key 或令牌。",
            "Sign-in methods, model availability and billing are set by OpenAI. VibeAcross never stores your API key or tokens.",
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
            "Codex CLI 是命令行工具。VibeAcross 通过「以项目目录为工作目录」的方式启动它，不注入额外参数。",
            "Codex CLI is a CLI tool. VibeAcross launches it with the project directory as the working directory and injects no extra arguments.",
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
              "若未检测到，用「手动配置」填写命令名（codex）或可执行文件路径。",
              "If not detected, use Configure manually to enter the command name (codex) or the executable path.",
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
              "VibeAcross 支持：自动检测、手动配置路径 / 命令、设为默认工具、以项目目录为工作目录受控启动。",
              "VibeAcross supports: auto-detection, manual path/command configuration, set as default, and controlled launch using the project folder as the working directory.",
            ),
            l(
              "取决于 Codex CLI 本身：登录、模型、对话内容与产品内功能。",
              "Depends on Codex CLI itself: login, models, conversation content and in-product features.",
            ),
            l(
              "官方文档提供了会话恢复命令（如 codex resume），但是否在应用内可用，需以本机核实结果与「工具」页显示为准。",
              "The official docs describe session resume commands (e.g. codex resume), but in-app availability depends on local verification and what the Tools page shows.",
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
            "安装后检测不到 Codex CLI 怎么办？",
            "Codex CLI is not detected after installation. What now?",
          ),
          answer: l(
            "先运行 codex --version 确认命令可用。若检测不到，请在「工具」页用「手动配置」填写命令名 codex 或可执行文件的完整路径。",
            "Run codex --version to confirm the command works. If still not detected, use Configure manually with the command codex or the full executable path.",
          ),
        },
        {
          id: "bad-path",
          question: l(
            "路径 / 命令配置错误如何修复？",
            "How do I fix a wrong path or command?",
          ),
          answer: l(
            "工具会显示「路径无效」。请重新编辑，或点击「重新验证」按当前保存值重新校验。",
            "The tool shows an invalid-path status. Edit it again, or click Revalidate to re-check the saved value.",
          ),
        },
        {
          id: "launch-failed",
          question: l(
            "启动失败怎么办？",
            "Launching fails. What now?",
          ),
          answer: l(
            "确认命令可运行、项目目录存在。若使用 API Key，请确认环境变量已正确设置（本应用不读取或存储密钥）。",
            "Confirm the command runs and the project directory exists. If you use an API key, ensure the environment variable is set correctly (VibeAcross does not read or store secrets).",
          ),
        },
        {
          id: "no-session",
          question: l(
            "为什么「按会话恢复」不可用？",
            "Why is \"restore by session\" unavailable?",
          ),
          answer: l(
            "只有当工具公开稳定接口、且已在本地端到端核实后，才会提供会话恢复。未核实的能力不会被当作支持。",
            "Session restore is offered only after the tool exposes a stable interface and it is verified end to end locally. Unverified capabilities are never treated as supported.",
          ),
        },
      ],
    },
  ],
};
