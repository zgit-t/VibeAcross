import { useState } from "react";
import {
  Download,
  ExternalLink,
  Folders,
  History,
  Link2,
  RefreshCw,
  RotateCcw,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTools } from "../context/ToolsContext";
import { APP_NAME, APP_REPOSITORY_URL, APP_VERSION } from "../config/app";
import logo from "../assets/logo.png";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n";
import { isDesktopRuntime, openExternalUrl, toErrorMessage } from "../services/backend";
import { useUpdateController } from "../features/update/useUpdateController";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import styles from "./AboutDialog.module.css";

interface FeatureItem {
  icon: LucideIcon;
  titleKey: TranslationKey;
  descKey: TranslationKey;
}

/** 核心功能：图标 + 文案，描述均以当前已实现的能力为准。 */
const FEATURES: FeatureItem[] = [
  {
    icon: Folders,
    titleKey: "about.feature.projects.title",
    descKey: "about.feature.projects.desc",
  },
  {
    icon: Wrench,
    titleKey: "about.feature.tools.title",
    descKey: "about.feature.tools.desc",
  },
  {
    icon: History,
    titleKey: "about.feature.sessions.title",
    descKey: "about.feature.sessions.desc",
  },
  {
    icon: Link2,
    titleKey: "about.feature.linking.title",
    descKey: "about.feature.linking.desc",
  },
];

/** 关于 VibeAcross：面向普通用户的产品介绍、核心功能、支持的工具、版本与源码入口。 */
export function AboutDialog() {
  const { aboutOpen, closeAbout } = useApp();
  const { t } = useI18n();
  const { tools, loading: toolsLoading } = useTools();
  const update = useUpdateController();
  const [linkError, setLinkError] = useState<string | null>(null);

  async function handleOpenSource() {
    setLinkError(null);
    try {
      await openExternalUrl(APP_REPOSITORY_URL);
    } catch (cause) {
      setLinkError(
        toErrorMessage(
          cause,
          t("about.openSourceFailed", { url: APP_REPOSITORY_URL }),
        ),
      );
    }
  }

  return (
    <Modal
      open={aboutOpen}
      onClose={closeAbout}
      title={t("about.title", { name: APP_NAME })}
      size="md"
      footer={
        <Button variant="secondary" onClick={closeAbout}>
          {t("common.close")}
        </Button>
      }
    >
      <div className={styles.content}>
        <header className={styles.brand}>
          <img
            className={styles.mark}
            src={logo}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <div className={styles.brandText}>
            <p className={styles.name}>{APP_NAME}</p>
            <p className={styles.tagline}>{t("about.tagline")}</p>
          </div>
        </header>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("about.featuresTitle")}</h3>
          <ul className={styles.features}>
            {FEATURES.map(({ icon: Icon, titleKey, descKey }) => (
              <li key={titleKey} className={styles.feature}>
                <span className={styles.featureIcon} aria-hidden="true">
                  <Icon size={18} />
                </span>
                <div className={styles.featureText}>
                  <p className={styles.featureTitle}>{t(titleKey)}</p>
                  <p className={styles.featureDesc}>{t(descKey)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("about.toolsTitle")}</h3>
          {tools.length > 0 ? (
            <ul className={styles.tools}>
              {tools.map((tool) => (
                <li key={tool.id} className={styles.tool}>
                  {tool.name}
                </li>
              ))}
            </ul>
          ) : toolsLoading ? null : (
            <p className={styles.hint}>{t("about.toolsEmpty")}</p>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("update.sectionTitle")}</h3>
          <div className={styles.updateRow}>
            {update.statusText && (
              <span className={styles.updateStatus}>{update.statusText}</span>
            )}
            {update.state.phase === "available" ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Download size={14} aria-hidden="true" />}
                onClick={update.download}
                disabled={!isDesktopRuntime()}
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
                disabled={update.busy || !isDesktopRuntime()}
              >
                {update.state.phase === "checking"
                  ? t("update.checking")
                  : t("update.check")}
              </Button>
            )}
          </div>
          {update.errorText && (
            <p className={styles.error}>{update.errorText}</p>
          )}
        </section>

        <div className={styles.footer}>
          <span className={styles.version}>
            {t("about.version", { version: APP_VERSION })}
          </span>
          <button
            type="button"
            className={styles.sourceLink}
            onClick={() => void handleOpenSource()}
            title={APP_REPOSITORY_URL}
          >
            <ExternalLink size={14} aria-hidden="true" />
            {t("about.viewSource")}
          </button>
        </div>

        {linkError && <p className={styles.error}>{linkError}</p>}
      </div>
    </Modal>
  );
}
