import { Search, X } from "lucide-react";
import { useId } from "react";
import styles from "./SearchInput.module.css";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 可访问名称，默认「搜索」。 */
  label?: string;
}

/** 带图标与清除按钮的搜索输入框。 */
export function SearchInput({
  value,
  onChange,
  placeholder = "搜索…",
  label = "搜索",
}: SearchInputProps) {
  const id = useId();

  return (
    <div className={styles.wrapper}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search className={styles.icon} size={15} aria-hidden="true" />
      <input
        id={id}
        type="search"
        className={styles.input}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          className={styles.clear}
          aria-label="清除搜索"
          title="清除搜索"
          onClick={() => onChange("")}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
