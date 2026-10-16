import type { ReactNode } from "react";
import styles from "./Section.module.css";

interface SectionProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  /** 是否给内容区加内边距（列表类内容通常由子项自带间距）。 */
  padded?: boolean;
}

/** 内容分区：标题行 + 可选操作 + 内容面板。 */
export function Section({
  title,
  description,
  action,
  children,
  padded = false,
}: SectionProps) {
  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>{title}</h2>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {action && <div className={styles.action}>{action}</div>}
      </div>
      <div className={`${styles.content} ${padded ? styles.padded : ""}`}>
        {children}
      </div>
    </section>
  );
}
