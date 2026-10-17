import { Download, RefreshCw, RotateCcw } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";
import {
  SettingsGroup,
  SettingsRow,
} from "../../components/layout/SettingsGroup";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Notice";
import { Switch } from "../../components/ui/Switch";
import { isDesktopRuntime } from "../../services/backend";
import { useUpdateController } from "./useUpdateController";
import styles from "./UpdateSettingsSection.module.css";

/** 设置页的「应用更新」分组：自动检查开关 + 手动检查与安装。 */
export function UpdateSettingsSection() {
  const { t } = useI18n();
  const { autoUpdate, setAutoUpdate, settingsLoaded } = useApp();
  const update = useUpdateController();
  const { phase } = update.state;
  const desktop = isDesktopRuntime();

  return (
    <SettingsGroup
      title={t("update.sectionTitle")}
      description={t("update.groupDescription")}
    >
      <SettingsRow
        label={t("update.autoLabel")}
        description={t("update.autoDescription")}
      >
        <Switch
          label={t("update.autoLabel")}
          checked={autoUpdate}
          onChange={setAutoUpdate}
          disabled={!settingsLoaded}
        />
      </SettingsRow>

      <SettingsRow
        label={t("update.checkLabel")}
        description={t("update.checkDescription")}
      >
        <div className={styles.status}>
          {update.statusText && (
            <span className={styles.statusText}>{update.statusText}</span>
          )}
          {update.lastCheckedText && !update.statusText && (
            <span className={styles.lastChecked}>{update.lastCheckedText}</span>
          )}
        </div>

        {phase === "available" ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Download size={14} aria-hidden="true" />}
            onClick={update.download}
            disabled={!desktop}
          >
            {t("update.download")}
          </Button>
        ) : update.ready ? (
          <Button
            variant="primary"
            size="sm"
            icon={<RotateCcw size={14} aria-hidden="true" />}
            onClick={update.install}
          >
            {t("update.installNow")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} aria-hidden="true" />}
            onClick={update.check}
            disabled={update.busy || !desktop}
          >
            {phase === "checking" ? t("update.checking") : t("update.check")}
          </Button>
        )}
      </SettingsRow>

      {update.errorText && (
        <Notice tone="danger" title={t("update.errorTitle")}>
          {update.errorText}
        </Notice>
      )}
    </SettingsGroup>
  );
}
