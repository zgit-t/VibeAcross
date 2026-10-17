import styles from "./RadioGroup.module.css";

/** 单选组中的一项。 */
export interface RadioOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  /** 附加的后果 / 风险提示（如操作后可能无法恢复）。 */
  note?: string;
  disabled?: boolean;
  /** 禁用原因；禁用时展示，说明为何该项不可用。 */
  disabledReason?: string;
}

interface RadioGroupProps<T extends string> {
  /** 同一组单选共享的表单名，需在本页内唯一。 */
  name: string;
  value: T;
  options: RadioOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * 通用单选组，用于在若干互斥选项中选择一个。
 *
 * 每项可附带说明、风险提示与禁用原因；使用原生 `input[type=radio]` 以保证可访问性。
 */
export function RadioGroup<T extends string>({
  name,
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: RadioGroupProps<T>) {
  return (
    <div className={styles.group} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        const isDisabled = disabled || option.disabled;
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className={`${styles.option} ${selected ? styles.selected : ""} ${
              isDisabled ? styles.disabled : ""
            }`}
          >
            <input
              id={id}
              type="radio"
              name={name}
              className={styles.input}
              value={option.value}
              checked={selected}
              disabled={isDisabled}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.text}>
              <span className={styles.label}>{option.label}</span>
              {option.description && (
                <span className={styles.description}>{option.description}</span>
              )}
              {isDisabled && option.disabledReason && (
                <span className={styles.reason}>{option.disabledReason}</span>
              )}
              {option.note && <span className={styles.note}>{option.note}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}
