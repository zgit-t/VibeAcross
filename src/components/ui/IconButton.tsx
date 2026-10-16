import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./IconButton.module.css";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 可访问名称，同时作为原生 tooltip 文本。 */
  label: string;
  size?: "sm" | "md";
  active?: boolean;
  children: ReactNode;
}

/** 纯图标按钮，必须提供 label 以保证可访问性。 */
export function IconButton({
  label,
  size = "md",
  active = false,
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  const classes = [
    styles.button,
    styles[size],
    active ? styles.active : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
