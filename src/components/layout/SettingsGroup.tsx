import type { ReactNode } from "react";
import styles from "./SettingsGroup.module.css";

interface SettingsGroupProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** 设置分组：标题 + 一组设置行。 */
export function SettingsGroup({
  title,
  description,
  children,
}: SettingsGroupProps) {
  return (
    <section className={styles.group}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}

interface SettingsRowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

/** 单条设置项：左侧说明，右侧控件。 */
export function SettingsRow({
  label,
  description,
  children,
}: SettingsRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <span className={styles.label}>{label}</span>
        {description && <span className={styles.hint}>{description}</span>}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  );
}
