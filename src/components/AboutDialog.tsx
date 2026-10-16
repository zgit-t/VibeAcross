import { useApp } from "../context/AppContext";
import { APP_NAME, APP_STACK, APP_VERSION } from "../config/app";
import logo from "../assets/logo.png";
import { useBackendInfo } from "../hooks/useBackendInfo";
import { useI18n } from "../i18n";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { GreetingDemo } from "./GreetingDemo";
import styles from "./AboutDialog.module.css";

/** 关于 VibeAcross：展示产品信息、技术栈，并保留第一阶段的后端通信示例。 */
export function AboutDialog() {
  const { aboutOpen, closeAbout } = useApp();
  const { t } = useI18n();
  const { isDesktop, appInfo, error, requestGreeting } = useBackendInfo();

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
        <div className={styles.identity}>
          <img
            className={styles.mark}
            src={logo}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <div>
            <p className={styles.name}>{APP_NAME}</p>
            <p className={styles.version}>
              {t("about.version", { version: APP_VERSION })}
            </p>
          </div>
        </div>

        <p className={styles.description}>{t("app.description")}</p>

        <dl className={styles.meta}>
          <div className={styles.metaRow}>
            <dt>{t("about.runtime")}</dt>
            <dd>
              {isDesktop
                ? t("about.desktopRuntime")
                : t("about.browserPreview")}
            </dd>
          </div>
          <div className={styles.metaRow}>
            <dt>{t("about.backendVersion")}</dt>
            <dd>
              {appInfo
                ? `${appInfo.name} ${appInfo.version}`
                : t("about.notConnected")}
            </dd>
          </div>
        </dl>

        <div className={styles.stackBlock}>
          <p className={styles.stackTitle}>{t("about.stack")}</p>
          <ul className={styles.stackList}>
            {APP_STACK.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <p className={styles.license}>{t("about.license")}</p>

        {error && <p className={styles.error}>{error}</p>}

        <GreetingDemo onGreet={requestGreeting} enabled={isDesktop} />
      </div>
    </Modal>
  );
}
