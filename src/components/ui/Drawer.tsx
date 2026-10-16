import { X } from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n/translate";
import { IconButton } from "./IconButton";
import styles from "./Drawer.module.css";

interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** 右侧抽屉面板，用于展示详情与执行次要操作。 */
export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: DrawerProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 className={styles.title}>{title}</h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          <IconButton label={t("common.close")} size="sm" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        </header>

        <div className={styles.body}>{children}</div>

        {footer && <footer className={styles.footer}>{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}
