import { l, type Tutorial } from "../types";

/** WorkBuddy（腾讯 AI 办公/编程代理桌面应用）教程。 */
export const workbuddyTutorial: Tutorial = {
  toolId: "workbuddy",
  toolName: "WorkBuddy",
  vendor: "Tencent",
  summary: l(
    "腾讯出品的全场景 AI 办公/编程代理桌面应用。",
    "Tencent's all-scenario AI office / coding agent desktop app.",
  ),
  sections: [
    {
      id: "official",
      title: l("官方信息与下载安装", "Official info & installation"),
      blocks: [
        {
          kind: "paragraph",
          text: l(
            "WorkBuddy 是腾讯出品的 AI 办公工作台，除办公场景外也提供代码开发等能力。它是一款桌面应用。",
            "WorkBuddy is Tencent's AI work platform; besides office scenarios it also offers code development capabilities. It is a desktop app.",
          ),
        },
        {
          kind: "bullets",
          items: [
            l("供应商：腾讯（Tencent）", "Vendor: Tencent"),
            l(
              "形态：桌面应用（Windows 10+、macOS）",
              "Form factor: desktop app (Windows 10+, macOS)",
            ),
            l(
              "官方站点：workbuddy.tencent.com",
              "Official site: workbuddy.tencent.com",
            ),
          ],
        },
        {
          kind: "links",
          links: [
            {
              kind: "home",
              label: l("官方站点", "Official site"),
              url: "https://workbuddy.tencent.com/",
              host: "workbuddy.tencent.com",
              note: l(
                "腾讯官方域名下的产品页与下载入口。",
                "Product page and download entry under Tencent's official domain.",
              ),
            },
          ],
        },
        {
          kind: "note",
          tone: "warning",
          text: l(
            "请从腾讯官方渠道下载。网络上存在不少仿冒「官网」的第三方下载站，非官方来源的安装包不受信任。",
            "Download only from Tencent's official channel. Many third-party sites imitate an official homepage; installers from unofficial sources are not trustworthy.",
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
              "安装完成后启动 WorkBuddy，按引导登录腾讯账号。",
              "After installation, launch WorkBuddy and sign in with your Tencent account.",
            ),
            l(
              "在应用内创建或选择一个工作空间 / 目录。",
              "Create or choose a workspace / directory inside the app.",
            ),
          ],
        },
        {
          kind: "note",
          tone: "info",
          text: l(
            "账号、额度与订阅要求由腾讯决定，请以官方页面为准。本应用不代管登录或凭据。",
            "Account, quota and subscription requirements are decided by Tencent. VibeAcross does not manage logins or credentials.",
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
            "WorkBuddy 官方未提供可确认的项目目录命令行参数。因此 VibeAcross 采用保守的启动方式：以项目目录为工作目录启动，不注入任何参数，需在应用内手动选择目录。",
            "WorkBuddy does not document a confirmed command-line argument for a project folder. VibeAcross therefore launches it conservatively: starting with the project folder as the working directory and injecting no arguments; you select the directory inside the app.",
          ),
        },
        {
          kind: "steps",
          items: [
            l(
              "在「工具」页点击「检测」自动扫描；安装位置不可预测时可能检测不到，此时使用「手动配置」指定可执行文件路径。",
              "Click Detect on the Tools page. Because the install location is unpredictable it may be missed; in that case use Configure manually.",
            ),
            l(
              "在项目上选择该工具，或「设为默认工具」后从项目页启动。",
              "Select the tool on a project, or Set as default and launch from the Projects page.",
            ),
            l(
              "启动后，在 WorkBuddy 应用内手动打开对应的工作目录。",
              "After launch, open the corresponding working directory manually inside WorkBuddy.",
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
              "VibeAcross 不支持：自动在该工具中打开指定项目（官方无公开参数）。",
              "VibeAcross does not support: automatically opening a specific project inside the tool (no public argument).",
            ),
            l(
              "取决于 WorkBuddy 本身：登录、技能 / 专家、会话与具体功能。",
              "Depends on WorkBuddy itself: login, skills / experts, sessions and specific features.",
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
            "为什么常常检测不到 WorkBuddy？",
            "Why is WorkBuddy often not detected?",
          ),
          answer: l(
            "其安装位置由用户自选，也可能通过应用商店安装，自动检测无法覆盖所有情况。请在「工具」页使用「手动配置」指定可执行文件路径。",
            "Its install location is user-defined and it may be installed via an app store, so auto-detection cannot cover every case. Use Configure manually on the Tools page.",
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
            "启动后没有自动打开项目是否正常？",
            "Is it normal that the project does not open automatically after launch?",
          ),
          answer: l(
            "是正常的。WorkBuddy 未公开项目目录参数，VibeAcross 只能以工作目录方式启动，需在应用内手动选择目录。",
            "Yes. WorkBuddy exposes no project-folder argument; VibeAcross can only start it with a working directory, so you must choose the directory inside the app.",
          ),
        },
        {
          id: "no-session",
          question: l(
            "VibeAcross 能管理 WorkBuddy 的历史会话吗？",
            "Can VibeAcross manage WorkBuddy's historical sessions?",
          ),
          answer: l(
            "不能。官方未公开可脚本化调用的会话接口，因此不提供会话创建 / 恢复。",
            "No. The vendor exposes no scriptable session interface, so session creation / restore is not provided.",
          ),
        },
      ],
    },
  ],
};
