import { l, type Tutorial } from "../types";

/** TRAE SOLO（字节跳动自主开发桌面应用）教程。 */
export const traeSoloTutorial: Tutorial = {
  toolId: "trae-solo",
  toolName: "TRAE SOLO",
  vendor: "ByteDance",
  summary: l(
    "字节跳动的 SOLO（AI 自主开发流程）桌面应用，与 Trae IDE 相互独立。",
    "ByteDance's SOLO desktop app for autonomous AI development, separate from the Trae IDE.",
  ),
  sections: [
    {
      id: "official",
      title: l("官方信息与下载安装", "Official info & installation"),
      blocks: [
        {
          kind: "paragraph",
          text: l(
            "TRAE SOLO 是字节跳动的 SOLO（自主开发流程）桌面应用，与 Trae IDE 是两个独立的产品。请勿将两者混为一谈，它们的可执行文件与安装目录不同。",
            "TRAE SOLO is ByteDance's SOLO (autonomous development workflow) desktop app. It is a product separate from the Trae IDE — do not confuse the two; they have different executables and install locations.",
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
            l("官方网站：www.trae.ai", "Official website: www.trae.ai"),
            l(
              "下载入口：以 TRAE 官方下载中心为准",
              "Download: see the official TRAE download center",
            ),
            l("官方文档：docs.trae.ai", "Official docs: docs.trae.ai"),
          ],
        },
        {
          kind: "links",
          links: [
            {
              kind: "home",
              label: l("官方站点（TRAE）", "Official site (TRAE)"),
              url: "https://www.trae.ai/",
              host: "www.trae.ai",
              note: l(
                "SOLO 由 TRAE 官方提供，具体下载入口以该站点为准。",
                "SOLO is published by TRAE; use this site for the actual download entry.",
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
          kind: "note",
          tone: "warning",
          text: l(
            "SOLO 的独立安装包下载入口可能随官方调整而变化，本教程不提供具体文件地址；请从 trae.ai 官方渠道获取，避免使用第三方下载站。",
            "The dedicated SOLO installer entry may change; this guide does not provide a specific file URL. Download only from the official trae.ai channel, never from third-party download sites.",
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
              "从官方渠道下载并安装 SOLO 桌面应用。",
              "Download and install the SOLO desktop app from the official channel.",
            ),
            l(
              "首次启动后按引导登录账号。",
              "On first launch, sign in following the on-screen guide.",
            ),
            l(
              "在应用内选择或新建工作目录 / 项目。",
              "Choose or create a working directory / project inside the app.",
            ),
          ],
        },
        {
          kind: "note",
          tone: "info",
          text: l(
            "账号与订阅要求由官方决定，请以官方页面为准。本应用不代管登录或凭据。",
            "Account and subscription requirements are set by the vendor. VibeAcross does not manage logins or credentials.",
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
            "TRAE SOLO 是桌面应用。VibeAcross 通过受控启动，将项目目录作为唯一参数打开，从而载入该项目。",
            "TRAE SOLO is a desktop app. VibeAcross uses controlled launch, opening the project folder as the single argument to load that project.",
          ),
        },
        {
          kind: "steps",
          items: [
            l(
              "在「工具」页点击「检测」自动扫描；若未发现则用「手动配置」指定 SOLO 的可执行文件路径。",
              "Click Detect on the Tools page; if it is missed, use Configure manually to point at SOLO's executable.",
            ),
            l(
              "注意区分 TRAE SOLO 与 Trae IDE 的可执行文件，避免配错路径。",
              "Be careful to distinguish the TRAE SOLO executable from the Trae IDE executable.",
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
              "取决于 SOLO 本身：登录、AI 工作流、会话内容与产品内功能。",
              "Depends on SOLO itself: login, AI workflows, session content and in-product features.",
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
            "检测不到 TRAE SOLO，却检测到了 Trae，怎么办？",
            "Only Trae is detected, not TRAE SOLO. What now?",
          ),
          answer: l(
            "两者是可执行文件名不同的独立产品。请手动配置 TRAE SOLO 的可执行文件路径（常见为 …\\TRAE SOLO CN\\TRAE SOLO CN.exe），再点击「重新验证」。",
            "They are separate products with different executable names. Manually configure the TRAE SOLO executable path (commonly …\\TRAE SOLO CN\\TRAE SOLO CN.exe), then click Revalidate.",
          ),
        },
        {
          id: "bad-path",
          question: l(
            "能否用 Trae 的路径代替 SOLO？",
            "Can I use Trae's path for SOLO?",
          ),
          answer: l(
            "不能。请填写 SOLO 自身的可执行文件路径，否则启动的会是 Trae IDE 而非 SOLO。",
            "No. Provide SOLO's own executable path, otherwise the Trae IDE will launch instead of SOLO.",
          ),
        },
        {
          id: "launch-failed",
          question: l(
            "启动后没有打开我的项目怎么办？",
            "The project did not open after launching. What now?",
          ),
          answer: l(
            "确认路径正确且 SOLO 能独立启动；若仍不行，请在 SOLO 内手动选择工作目录作为临时替代。",
            "Ensure the path is correct and SOLO launches on its own. If not, select the working directory manually inside SOLO as a fallback.",
          ),
        },
        {
          id: "no-session",
          question: l(
            "SOLO 支持按历史会话恢复吗？",
            "Does SOLO support restoring by historical session?",
          ),
          answer: l(
            "SOLO 为桌面应用，官方未公开可脚本化调用的会话恢复方式，因此 VibeAcross 仅支持重新打开项目。",
            "SOLO is a desktop app without a scriptable session-resume interface, so VibeAcross only supports reopening the project.",
          ),
        },
      ],
    },
  ],
};
