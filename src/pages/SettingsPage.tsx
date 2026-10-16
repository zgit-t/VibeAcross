import { useEffect, useMemo, useState } from "react";
import {
  Eraser,
  FolderOpen,
  FolderX,
  Monitor,
  Moon,
  RotateCcw,
  Save,
  Sun,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useActivity } from "../context/ActivityContext";
import { useTools } from "../context/ToolsContext";
import { PageHeader } from "../components/layout/PageHeader";
import {
  SettingsGroup,
  SettingsRow,
} from "../components/layout/SettingsGroup";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Switch } from "../components/ui/Switch";
import { Notice } from "../components/ui/Notice";
import { APP_DESCRIPTION, APP_NAME, APP_VERSION } from "../config/app";
import { pickDirectory } from "../services/dialog";
import { getStorageInfo } from "../services/settings";
import { clearActivity } from "../services/activity";
import { isDesktopRuntime, toErrorMessage } from "../services/backend";
import type { StorageInfo } from "../types/domain";
import type { ThemeMode } from "../types/navigation";
import styles from "./SettingsPage.module.css";

const THEME_OPTIONS = [
  { value: "light" as ThemeMode, label: "Light", icon: <Sun size={14} aria-hidden="true" /> },
  { value: "dark" as ThemeMode, label: "Dark", icon: <Moon size={14} aria-hidden="true" /> },
  { value: "system" as ThemeMode, label: "System", icon: <Monitor size={14} aria-hidden="true" /> },
];

/** 设置页面。默认目录与主题写入 SQLite，其余为预留占位。 */
export function SettingsPage() {
  const {
    themeMode,
    setThemeMode,
    defaultProjectFolder,
    setDefaultProjectFolder,
    showLastContextOnStartup,
    setShowLastContextOnStartup,
    autoRestoreLastContext,
    setAutoRestoreLastContext,
    settingsLoaded,
    settingsError,
    clearSettingsError,
    openAbout,
    navigate,
  } = useApp();
  const { tools, setDefaultTool } = useTools();
  const { bumpRevision } = useActivity();
  const detectedTools = useMemo(
    () => tools.filter((tool) => tool.installed),
    [tools],
  );
  const defaultTool = useMemo(
    () => tools.find((tool) => tool.isDefault)?.id ?? "",
    [tools],
  );
  const [detectOnStart, setDetectOnStart] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [activityNotice, setActivityNotice] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);

  async function handleClearActivity() {
    setClearing(true);
    setActivityNotice(null);
    setActivityError(null);
    try {
      await clearActivity(null);
      setConfirmClear(false);
      bumpRevision();
      setActivityNotice("活动记录已清理。");
    } catch (cause) {
      setActivityError(toErrorMessage(cause, "清理活动记录失败。"));
    } finally {
      setClearing(false);
    }
  }

  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const info = await getStorageInfo();
        if (!cancelled) {
          setStorageInfo(info);
          setStorageError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setStorageError(toErrorMessage(cause, "读取数据目录失败。"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleBrowseDefaultFolder() {
    const selected = await pickDirectory({ defaultPath: defaultProjectFolder });
    if (selected) {
      clearSettingsError();
      setDefaultProjectFolder(selected);
    }
  }

  async function handleDefaultToolChange(id: string) {
    try {
      await setDefaultTool(id || null);
      setToolError(null);
    } catch (cause) {
      setToolError(toErrorMessage(cause, "设置默认工具失败。"));
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Settings"
        description="应用偏好与本地数据相关设置。"
      />

      {settingsError && (
        <Notice tone="danger" title="保存设置失败">
          {settingsError}
        </Notice>
      )}

      {storageError && (
        <Notice tone="danger" title="读取数据目录失败">
          {storageError}
        </Notice>
      )}

      {activityNotice && <Notice tone="success">{activityNotice}</Notice>}
      {activityError && <Notice tone="danger">{activityError}</Notice>}

      <SettingsGroup
        title="General"
        description="通用行为设置。"
      >
        <SettingsRow
          label="默认项目文件夹"
          description="创建新项目时的默认所在目录。"
        >
          <input
            className={styles.readonlyInput}
            value={defaultProjectFolder ?? "尚未设置"}
            readOnly
            aria-label="默认项目文件夹"
            title={defaultProjectFolder ?? ""}
          />
          <Button
            variant="secondary"
            size="sm"
            icon={<FolderOpen size={14} aria-hidden="true" />}
            onClick={handleBrowseDefaultFolder}
            disabled={!isDesktopRuntime()}
          >
            浏览…
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<FolderX size={14} aria-hidden="true" />}
            onClick={() => {
              clearSettingsError();
              setDefaultProjectFolder(null);
            }}
            disabled={!defaultProjectFolder}
          >
            清除
          </Button>
        </SettingsRow>

        <SettingsRow label="启动行为" description="应用启动时打开的页面。">
          <select
            className={styles.select}
            aria-label="启动行为"
            defaultValue="overview"
            disabled
          >
            <option value="overview">打开概览</option>
            <option value="last">打开上次的页面</option>
          </select>
          <Badge tone="neutral">即将支持</Badge>
        </SettingsRow>

        <SettingsRow label="界面语言" description="应用显示语言。">
          <select
            className={styles.select}
            aria-label="界面语言"
            defaultValue="zh-CN"
            disabled
          >
            <option value="zh-CN">简体中文</option>
          </select>
          <Badge tone="neutral">即将支持</Badge>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Appearance"
        description="外观与主题。切换会立即应用到整个应用。"
      >
        <SettingsRow label="主题" description="选择浅色、深色或跟随系统。">
          <SegmentedControl
            ariaLabel="主题"
            options={THEME_OPTIONS}
            value={themeMode}
            onChange={setThemeMode}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Tools"
        description="开发工具的默认行为与检测设置。"
      >
        <SettingsRow label="默认开发工具" description="打开项目时优先使用的工具。">
          <select
            className={styles.select}
            aria-label="默认开发工具"
            value={defaultTool}
            disabled={!isDesktopRuntime() || detectedTools.length === 0}
            onChange={(event) => void handleDefaultToolChange(event.target.value)}
          >
            <option value="">未设置</option>
            {detectedTools.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {tool.name}
                {tool.version ? ` (${tool.version})` : ""}
              </option>
            ))}
          </select>
          {detectedTools.length === 0 && (
            <Badge tone="neutral">尚无已检测到的工具</Badge>
          )}
        </SettingsRow>

        <SettingsRow
          label="启动时自动检测工具"
          description="在应用启动时检测本机已安装的工具。"
        >
          <Switch
            label="启动时自动检测工具"
            checked={detectOnStart}
            onChange={setDetectOnStart}
            disabled
          />
        </SettingsRow>

        <SettingsRow label="工具配置" description="检测、配置本机安装的开发工具。">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate("tools")}
            disabled={!isDesktopRuntime()}
          >
            打开 Tools
          </Button>
        </SettingsRow>

        {toolError && <Notice tone="danger">{toolError}</Notice>}
      </SettingsGroup>

      <SettingsGroup
        title="Recovery"
        description="工作环境恢复行为。默认不会擅自启动外部程序。"
      >
        <SettingsRow
          label="启动时显示最近的工作上下文"
          description="在概览页展示上次的工作环境，方便一键恢复。"
        >
          <Switch
            label="启动时显示最近的工作上下文"
            checked={showLastContextOnStartup}
            onChange={setShowLastContextOnStartup}
            disabled={!settingsLoaded}
          />
        </SettingsRow>

        <SettingsRow
          label="启动时自动恢复"
          description="打开应用时自动启动上次使用的项目与工具。默认关闭。"
        >
          <Switch
            label="启动时自动恢复"
            checked={autoRestoreLastContext}
            onChange={setAutoRestoreLastContext}
            disabled={!settingsLoaded}
          />
        </SettingsRow>

        <SettingsRow
          label="管理工作上下文"
          description="查看、保存或删除工作上下文记录。"
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate("sessions")}
          >
            打开 Sessions
          </Button>
        </SettingsRow>

        <Notice tone="info">
          自动恢复仅重建 Level 1 工作环境（启动工具并打开项目目录），
          不会恢复第三方工具的 AI 对话。恢复失败时会退回正常界面。
        </Notice>
      </SettingsGroup>

      <SettingsGroup
        title="Data & Storage"
        description="本地数据存储说明。"
      >
        <SettingsRow
          label="本地优先"
          description="VibeAcross 的数据保存在本机，不会上传到任何服务器。"
        >
          <Badge tone="accent">本地存储</Badge>
        </SettingsRow>

        <SettingsRow label="数据目录" description="SQLite 数据库与配置文件的保存位置。">
          <code className={styles.pathValue}>
            {storageInfo?.appDataDir ?? "读取中…"}
          </code>
        </SettingsRow>

        <SettingsRow label="数据库文件" description="项目、任务与设置的存储文件。">
          <code className={styles.pathValue}>
            {storageInfo?.databasePath ?? "读取中…"}
          </code>
        </SettingsRow>

        <SettingsRow
          label="活动记录"
          description="清理本机保存的全部操作历史，不影响项目与任务数据。"
        >
          <Button
            variant="secondary"
            size="sm"
            icon={<Eraser size={14} aria-hidden="true" />}
            onClick={() => setConfirmClear(true)}
            disabled={!isDesktopRuntime()}
          >
            清理活动记录
          </Button>
        </SettingsRow>

        <SettingsRow label="备份与恢复" description="导出或导入本地数据。">
          <Button
            variant="secondary"
            size="sm"
            icon={<Save size={14} aria-hidden="true" />}
            disabled
            title="备份将在后续阶段支持"
          >
            备份
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw size={14} aria-hidden="true" />}
            disabled
            title="恢复将在后续阶段支持"
          >
            恢复
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="About" description="产品或版本信息。">
        <SettingsRow label={APP_NAME} description={APP_DESCRIPTION}>
          <Badge tone="neutral">版本 {APP_VERSION}</Badge>
          <Button variant="secondary" size="sm" onClick={openAbout}>
            查看关于
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <Notice tone="info">
        默认项目文件夹、主题、默认开发工具与工作环境恢复选项已保存到本机 SQLite 数据库；本页其余设置项仍为界面占位。
      </Notice>

      <ConfirmDialog
        open={confirmClear}
        title="清理全部活动记录？"
        description="将删除本机保存的全部操作历史，此操作无法撤销。项目与任务数据不受影响。"
        confirmLabel="清理"
        tone="danger"
        busy={clearing}
        onConfirm={handleClearActivity}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}
