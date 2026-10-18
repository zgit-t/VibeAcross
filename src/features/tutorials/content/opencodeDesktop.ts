import { l, type Tutorial } from "../types";

/** OpenCode Desktop（图形界面应用）教程。 */
export const opencodeDesktopTutorial: Tutorial = {
  toolId: "opencode-desktop",
  toolName: "OpenCode Desktop",
  vendor: "OpenCode",
  summary: l(
    "OpenCode 官方桌面应用（图形界面），与命令行工具共用同一份本地会话存储。",
    "OpenCode's official desktop app (GUI), sharing the same local session store as the CLI.",
  ),
  sections: [
    {
      id: "official",
      title: l("官方信息与下载安装", "Official info & installation"),
      blocks: [
        {
          kind: "paragraph",
          text: l(
            "OpenCode Desktop 是 OpenCode 的图形界面应用，适合偏好可视化操作的开发者。它与 OpenCode 命令行工具共用同一份本地会话存储。",
            "OpenCode Desktop is the graphical app for OpenCode, suited to developers who prefer a visual workflow. It shares the same local session store as the OpenCode CLI.",
          ),
        },
        {
          kind: "bullets",
          items: [
            l("供应商：OpenCode（开源）", "Vendor: OpenCode (open source)"),
            l(
              "形态：桌面应用（Windows、macOS、Linux）",
              "Form factor: desktop app (Windows, macOS, Linux)",
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
              note: l(
                "提供桌面应用的下载入口。",
                "Provides the desktop app download entry.",
              ),
            },
            {
              kind: "docs",
              label: l("官方文档", "Official documentation"),
              url: "https://opencode.ai/docs",
              host: "opencode.ai",
              note: l("安装与使用说明以此处为准。", "Use this as the source of truth for installation and usage."),
            },
          ],
        },
        {
          kind: "note",
          tone: "info",
          text: l(
            "桌面应用与命令行工具是可执行文件名不同、安装位置不同的两个程序，请勿混淆。",
            "The desktop app and the CLI are two programs with different executable names and install locations; do not confuse them.",
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
              "从官方渠道下载并安装桌面应用。",
              "Download and install the desktop app from the official channel.",
            ),
            l(
              "首次启动后按引导连接模型提供商。",
              "On first launch, connect a model provider following the guide.",
            ),
            l(
              "在应用内打开或新建项目。",
              "Open or create a project inside the app.",
            ),
          ],
        },
        {
          kind: "note",
          tone: "info",
          text: l(
            "模型连接与计费由各提供商决定，请以官方文档为准。本应用不会存储你的 API Key 或令牌。",
            "Model connections and billing are set by each provider. VibeAcross never stores your API keys or tokens.",
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
            "OpenCode Desktop 是桌面应用。未核实其项目目录命令行参数，因此 VibeAcross 采用保守的启动方式：以项目目录为工作目录启动，不注入任何参数，需在应用内手动打开项目。",
            "OpenCode Desktop is a desktop app. Its project-folder command-line argument is unverified, so VibeAcross launches it conservatively: with the project folder as the working directory and no arguments; you open the project inside the app.",
          ),
        },
        {
          kind: "steps",
          items: [
            l(
              "在「工具」页点击「检测」自动扫描；桌面应用的安装位置可能不可预测，检测不到时使用「手动配置」指定可执行文件路径。",
              "Click Detect on the Tools page. The desktop app's install location may be unpredictable; if missed, use Configure manually.",
            ),
            l(
              "注意不要用 OpenCode CLI 的 opencode 命令来配置桌面应用，两者可执行文件不同。",
              "Do not use the OpenCode CLI's opencode command to configure the desktop app; their executables differ.",
            ),
            l(
              "按需「设为默认工具」，即可从项目页启动。",
              "Optionally Set as default to launch from the Projects page.",
            ),
          ],
        },
        {
          kind: "bullets",
          items: [
            l(
              "VibeAcross 支持：自动检测、手动配置路径、设为默认工具、以项目目录为工作目录的受控启动。",
              "VibeAcross supports: auto-detection, manual path configuration, set as default, and controlled launch using the project folder as the working directory.",
            ),
            l(
              "VibeAcross 不支持：自动在应用内打开指定项目，以及脚本化的会话创建 / 恢复 / 改名 / 删除（其内嵌服务仅监听随机回环端口并使用随机密码）。",
              "VibeAcross does not support: automatically opening a specific project inside the app, nor scripted session create / restore / rename / delete (its embedded service listens on a random loopback port with a random password).",
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
            "检测不到 OpenCode Desktop，却检测到了 OpenCode CLI？",
            "The OpenCode CLI is detected but not OpenCode Desktop. What now?",
          ),
          answer: l(
            "两者可执行文件名不同（OpenCode.exe 与 opencode.exe）。请用「手动配置」指定桌面应用的 OpenCode.exe 完整路径，再点击「重新验证」。",
            "Their executable names differ (OpenCode.exe vs opencode.exe). Use Configure manually to point at the desktop app's OpenCode.exe, then click Revalidate.",
          ),
        },
        {
          id: "bad-path",
          question: l(
            "路径配置错误会怎样？",
            "What happens with a wrong path?",
          ),
          answer: l(
            "工具会显示「路径无效」，启动失败。请重新编辑路径或点击「重新验证」。",
            "The tool shows an invalid-path status and launching fails. Edit the path again or click Revalidate.",
          ),
        },
        {
          id: "launch-failed",
          question: l(
            "启动后没有自动打开我的项目，正常吗？",
            "Is it normal that my project does not open automatically?",
          ),
          answer: l(
            "正常。未核实桌面应用的项目目录参数，VibeAcross 只能以工作目录方式启动，请在应用内手动打开项目。",
            "Yes. The desktop app's project-folder argument is unverified, so VibeAcross only starts it with a working directory; open the project inside the app.",
          ),
        },
        {
          id: "no-session",
          question: l(
            "VibeAcross 能管理 OpenCode Desktop 的会话吗？",
            "Can VibeAcross manage OpenCode Desktop sessions?",
          ),
          answer: l(
            "只能只读地枚举历史会话，不支持脚本化的会话创建 / 恢复 / 改名 / 删除，因为其内嵌服务不可从外部安全连接。",
            "It can only read-enumerate historical sessions; scripted create / restore / rename / delete is not supported because the embedded service cannot be safely reached externally.",
          ),
        },
      ],
    },
  ],
};
