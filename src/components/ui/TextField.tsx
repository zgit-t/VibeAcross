import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./Field.module.css";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  /**
   * 与输入框同一行、位于其右侧的附属控件（例如「浏览」按钮）。
   * 放在控制行内部可让按钮始终与输入框对齐，不受标签 / 提示 / 错误影响。
   */
  trailing?: ReactNode;
}

/** 带标签、提示与错误信息的文本输入项。 */
export function TextField({
  label,
  error,
  hint,
  required,
  trailing,
  className,
  ...rest
}: TextFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required && <span className={styles.required}> *</span>}
      </label>
      <div className={styles.controlRow}>
        <input
          id={id}
          className={`${styles.control} ${error ? styles.invalid : ""} ${
            className ?? ""
          }`}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [hintId, errorId].filter(Boolean).join(" ") || undefined
          }
          {...rest}
        />
        {trailing && <span className={styles.trailing}>{trailing}</span>}
      </div>
      {hint && !error && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
