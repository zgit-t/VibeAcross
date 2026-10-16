import { useState } from "react";
import type { FormEvent } from "react";
import { useI18n } from "../i18n";
import styles from "./GreetingDemo.module.css";

interface GreetingDemoProps {
  /** 调用 Rust 后端 greet 命令的封装方法。 */
  onGreet: (name: string) => Promise<string>;
  /** 是否处于 Tauri 宿主环境。 */
  enabled: boolean;
}

/**
 * 最小前后端通信示例：输入名称后调用 Rust 后端并展示返回值。
 * 用于验证 Tauri IPC 通道是否正常工作。
 */
export function GreetingDemo({ onGreet, enabled }: GreetingDemoProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const message = await onGreet(name);
      setResult(message);
    } catch (err: unknown) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.demo}>
      <h2 className={styles.title}>{t("greeting.title")}</h2>
      <p className={styles.hint}>
        {t("greeting.hintBefore")} <code>{t("greeting.hintCode")}</code>{" "}
        {t("greeting.hintAfter")}
      </p>
      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          type="text"
          value={name}
          placeholder={t("greeting.placeholder")}
          onChange={(event) => setName(event.target.value)}
          disabled={!enabled || pending}
        />
        <button className={styles.button} type="submit" disabled={!enabled || pending}>
          {pending ? t("greeting.sending") : t("greeting.send")}
        </button>
      </form>

      {!enabled && <p className={styles.offline}>{t("greeting.offline")}</p>}
      {result && <p className={styles.result}>{result}</p>}
      {error && (
        <p className={styles.error}>
          {t("greeting.failure", { message: error })}
        </p>
      )}
    </section>
  );
}
