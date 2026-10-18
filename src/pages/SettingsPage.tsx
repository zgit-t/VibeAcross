import { useEffect, useMemo, useState } from "react";
import { FolderOpen, FolderX, Monitor, Moon, Sun } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTools } from "../context/ToolsContext";
import { LOCALE_LABEL, SUPPORTED_LOCALES, useI18n } from "../i18n";
import type { Locale } from "../i18n";
import { PageHeader } from "../components/layout/PageHeader";
import {
  SettingsGroup,
  SettingsRow,
} from "../components/layout/SettingsGroup";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Switch } from "../components/ui/Switch";
import { Notice } from "../components/ui/Notice";
import { BackupSection } from "../features/backup/BackupSection";
import { DiagnosticsSection } from "../features/diagnostics/DiagnosticsSection";
import { UpdateSettingsSection } from "../features/update/UpdateSettingsSection";
import { APP_NAME, APP_VERSION } from "../config/app";
import { pickDirectory } from "../services/dialog";
import { getStorageInfo } from "../services/settings";
import { isDesktopRuntime, toErrorMessage } from "../services/backend";
import type { StorageInfo } from "../types/domain";
import type { ThemeMode } from "../types/navigation";
import styles from "./SettingsPage.module.css";

/** 设置页面。所有可交互项均写入本机 SQLite 数据库。 */
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
    language,
    setLanguage,
    settingsLoaded,
    settingsError,
    clearSettingsError,
    openAbout,
    navigate,
  } = useApp();
  const { t } = useI18n();
  const { tools, setDefaultTool } = useTools();

  const themeOptions = useMemo(
    () => [
      {
        value: "light" as ThemeMode,
        label: t("settings.themeLight"),
        icon: <Sun size={14} aria-hidden="true" />,
      },
      {
        value: "dark" as ThemeMode,
        label: t("settings.themeDark"),
        icon: <Moon size={14} aria-hidden="true" />,
      },
      {
        value: "system" as ThemeMode,
        label: t("settings.themeSystem"),
        icon: <Monitor size={14} aria-hidden="true" />,
      },
    ],
    [t],
  );

  const detectedTools = useMemo(
    () => tools.filter((tool) => tool.installed),
    [tools],
  );
  const defaultTool = useMemo(
    () => tools.find((tool) => tool.isDefault)?.id ?? "",
    [tools],
  );
  const [toolError, setToolError] = useState<string | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

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
          setStorageError(toErrorMessage(cause, t("settings.readStorageFailed")));
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
      setToolError(toErrorMessage(cause, t("settings.setDefaultToolFailed")));
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t("settings.title")}
        description={t("settings.description")}
      />

      {settingsError && (
        <Notice tone="danger" title={t("settings.saveFailedTitle")}>
          {settingsError}
        </Notice>
      )}

      {storageError && (
        <Notice tone="danger" title={t("settings.storageFailedTitle")}>
          {storageError}
        </Notice>
      )}

      <SettingsGroup
        title={t("settings.generalTitle")}
        description={t("settings.generalDescription")}
      >
        <SettingsRow
          label={t("settings.defaultFolderLabel")}
          description={t("settings.defaultFolderDescription")}
        >
          <input
            className={styles.readonlyInput}
            value={defaultProjectFolder ?? t("common.notSet")}
            readOnly
            aria-label={t("settings.defaultFolderAria")}
            title={defaultProjectFolder ?? ""}
          />
          <Button
            variant="secondary"
            size="sm"
            icon={<FolderOpen size={14} aria-hidden="true" />}
            onClick={handleBrowseDefaultFolder}
            disabled={!isDesktopRuntime()}
          >
            {t("common.browse")}
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
            {t("common.clear")}
          </Button>
        </SettingsRow>

        <SettingsRow
          label={t("settings.languageLabel")}
          description={t("settings.languageDescription")}
        >
          <select
            className={styles.select}
            aria-label={t("settings.languageLabel")}
            value={language}
            onChange={(event) => setLanguage(event.target.value as Locale)}
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {LOCALE_LABEL[locale]}
              </option>
            ))}
          </select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.appearanceTitle")}
        description={t("settings.appearanceDescription")}
      >
        <SettingsRow
          label={t("settings.themeLabel")}
          description={t("settings.themeDescription")}
        >
          <SegmentedControl
            ariaLabel={t("settings.themeAria")}
            options={themeOptions}
            value={themeMode}
            onChange={setThemeMode}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.toolsTitle")}
        description={t("settings.toolsDescription")}
      >
        <SettingsRow
          label={t("settings.defaultToolLabel")}
          description={t("settings.defaultToolDescription")}
        >
          <select
            className={styles.select}
            aria-label={t("settings.defaultToolAria")}
            value={defaultTool}
            disabled={!isDesktopRuntime() || detectedTools.length === 0}
            onChange={(event) => void handleDefaultToolChange(event.target.value)}
          >
            <option value="">{t("settings.notSetOption")}</option>
            {detectedTools.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {tool.name}
                {tool.version ? ` (${tool.version})` : ""}
              </option>
            ))}
          </select>
          {detectedTools.length === 0 && (
            <Badge tone="neutral">{t("settings.noDetectedTools")}</Badge>
          )}
        </SettingsRow>

        <SettingsRow
          label={t("settings.toolConfigLabel")}
          description={t("settings.toolConfigDescription")}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate("tools")}
            disabled={!isDesktopRuntime()}
          >
            {t("settings.openTools")}
          </Button>
        </SettingsRow>

        {toolError && <Notice tone="danger">{toolError}</Notice>}
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.recoveryTitle")}
        description={t("settings.recoveryDescription")}
      >
        <SettingsRow
          label={t("settings.showLastLabel")}
          description={t("settings.showLastDescription")}
        >
          <Switch
            label={t("settings.showLastLabel")}
            checked={showLastContextOnStartup}
            onChange={setShowLastContextOnStartup}
            disabled={!settingsLoaded}
          />
        </SettingsRow>

        <SettingsRow
          label={t("settings.autoRestoreLabel")}
          description={t("settings.autoRestoreDescription")}
        >
          <Switch
            label={t("settings.autoRestoreLabel")}
            checked={autoRestoreLastContext}
            onChange={setAutoRestoreLastContext}
            disabled={!settingsLoaded}
          />
        </SettingsRow>

        <SettingsRow
          label={t("settings.manageContextLabel")}
          description={t("settings.manageContextDescription")}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate("sessions")}
          >
            {t("settings.openSessions")}
          </Button>
        </SettingsRow>

        <Notice tone="info">{t("settings.recoveryNotice")}</Notice>
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.dataTitle")}
        description={t("settings.dataDescription")}
      >
        <SettingsRow
          label={t("settings.localFirstLabel")}
          description={t("settings.localFirstDescription")}
        >
          <Badge tone="accent">{t("settings.localBadge")}</Badge>
        </SettingsRow>

        <SettingsRow
          label={t("settings.dataDirLabel")}
          description={t("settings.dataDirDescription")}
        >
          <code className={styles.pathValue}>
            {storageInfo?.appDataDir ?? t("common.reading")}
          </code>
        </SettingsRow>

        <SettingsRow
          label={t("settings.dbFileLabel")}
          description={t("settings.dbFileDescription")}
        >
          <code className={styles.pathValue}>
            {storageInfo?.databasePath ?? t("common.reading")}
          </code>
        </SettingsRow>
      </SettingsGroup>

      <BackupSection />

      <DiagnosticsSection />

      <UpdateSettingsSection />

      <SettingsGroup
        title={t("settings.aboutTitle")}
        description={t("settings.aboutDescription")}
      >
        <SettingsRow label={APP_NAME} description={t("app.description")}>
          <Badge tone="neutral">
            {t("settings.aboutVersion", { version: APP_VERSION })}
          </Badge>
          <Button variant="secondary" size="sm" onClick={openAbout}>
            {t("settings.viewAbout")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
