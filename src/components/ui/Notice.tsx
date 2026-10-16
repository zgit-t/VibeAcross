import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./Notice.module.css";

type NoticeTone = "info" | "warning" | "danger" | "success";

interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
}

const ICONS = {
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
  success: Info,
} as const;

/** 页面内联提示条，用于说明未实现状态、错误或警告。 */
export function Notice({ tone = "info", title, children }: NoticeProps) {
  const Icon = ICONS[tone];
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role="status">
      <Icon size={16} className={styles.icon} aria-hidden="true" />
      <div className={styles.content}>
        {title && <p className={styles.title}>{title}</p>}
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
