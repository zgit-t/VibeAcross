import { Spinner } from "./Spinner";
import styles from "./LoadingState.module.css";

interface LoadingStateProps {
  /** 加载文案（由调用方按当前语言提供）。 */
  label: string;
  /** 指示器尺寸，默认 16。 */
  size?: number;
}

/**
 * 行内加载状态：旋转指示器 + 简洁文案。
 *
 * 轻量、不阻塞、不使用大面积遮罩；放在内容原位置，避免整页闪烁或重新布局。
 * 通过 `role="status"` + `aria-live="polite"` 让辅助技术感知加载开始与结束。
 */
export function LoadingState({ label, size = 16 }: LoadingStateProps) {
  return (
    <p className={styles.loading} role="status" aria-live="polite">
      <Spinner size={size} />
      <span>{label}</span>
    </p>
  );
}
