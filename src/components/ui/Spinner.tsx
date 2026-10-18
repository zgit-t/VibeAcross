import { LoaderCircle } from "lucide-react";
import styles from "./Spinner.module.css";

interface SpinnerProps {
  /** 图标像素尺寸，默认 16。 */
  size?: number;
  /** 附加类名。 */
  className?: string;
}

/**
 * 轻量加载指示器（旋转图标）。
 *
 * 仅作视觉指示，默认 `aria-hidden`；如需无障碍播报，请配合 `LoadingState`
 * 或带 `role="status"` 的容器使用。动画会在系统「减少动态效果」下自动近似静止
 * （见 `styles/global.css` 的全局偏好覆盖）。
 */
export function Spinner({ size = 16, className }: SpinnerProps) {
  return (
    <LoaderCircle
      className={className ? `${styles.spinner} ${className}` : styles.spinner}
      size={size}
      strokeWidth={2}
      aria-hidden="true"
    />
  );
}
