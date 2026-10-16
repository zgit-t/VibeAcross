import { useApp } from "../context/AppContext";
import { APP_DESCRIPTION, APP_NAME, APP_STACK, APP_VERSION } from "../config/app";
import { useBackendInfo } from "../hooks/useBackendInfo";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { GreetingDemo } from "./GreetingDemo";
import styles from "./AboutDialog.module.css";

/** 关于 VibeAcross：展示产品信息、技术栈，并保留第一阶段的后端通信示例。 */
export function AboutDialog() {
  const { aboutOpen, closeAbout } = useApp();
  const { isDesktop, appInfo, error, requestGreeting } = useBackendInfo();

  return (
    <Modal
      open={aboutOpen}
      onClose={closeAbout}
      title={`关于 ${APP_NAME}`}
      size="md"
      footer={
        <Button variant="secondary" onClick={closeAbout}>
          关闭
        </Button>
      }
    >
      <div className={styles.content}>
        <div className={styles.identity}>
          <span className={styles.mark} aria-hidden="true">
            VA
          </span>
          <div>
            <p className={styles.name}>{APP_NAME}</p>
            <p className={styles.version}>版本 {APP_VERSION}</p>
          </div>
        </div>

        <p className={styles.description}>{APP_DESCRIPTION}</p>

        <dl className={styles.meta}>
          <div className={styles.metaRow}>
            <dt>运行环境</dt>
            <dd>{isDesktop ? "Tauri 桌面窗口" : "浏览器预览（未连接后端）"}</dd>
          </div>
          <div className={styles.metaRow}>
            <dt>后端版本</dt>
            <dd>{appInfo ? `${appInfo.name} ${appInfo.version}` : "未连接"}</dd>
          </div>
        </dl>

        <div className={styles.stackBlock}>
          <p className={styles.stackTitle}>技术栈</p>
          <ul className={styles.stackList}>
            {APP_STACK.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <p className={styles.license}>
          开源许可信息将在后续阶段随依赖清单一并提供，当前不做声明。
        </p>

        {error && <p className={styles.error}>{error}</p>}

        <GreetingDemo onGreet={requestGreeting} enabled={isDesktop} />
      </div>
    </Modal>
  );
}
