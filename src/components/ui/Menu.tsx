import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./IconButton";
import styles from "./Menu.module.css";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  /** 禁用项的说明，作为 tooltip 展示。 */
  disabledHint?: string;
  danger?: boolean;
}

interface MenuProps {
  /** 触发按钮的可访问名称。 */
  label: string;
  items: MenuItem[];
  align?: "start" | "end";
}

/** 触发按钮与浮层之间的间距（px）。 */
const GAP = 4;
/** 浮层与视口边缘的最小间距（px）。 */
const VIEWPORT_MARGIN = 8;

/**
 * 轻量下拉菜单，用于列表项的更多操作。
 *
 * 浮层通过 Portal 渲染到 `document.body`，并使用 `position: fixed` 定位。
 * 这样可以脱离列表卡片的 `overflow: hidden` 以及内容区的滚动容器，
 * 避免浮层被裁剪或压在其它元素之下。
 */
export function Menu({ label, items, align = "end" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 依据触发按钮的位置计算浮层坐标，必要时向上翻转并夹在视口内。
  const updatePosition = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const menu = menuRef.current;
    const rect = wrapper.getBoundingClientRect();
    const menuWidth = menu?.offsetWidth ?? 176;
    const menuHeight = menu?.offsetHeight ?? 0;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = rect.bottom + GAP;
    if (
      menuHeight > 0 &&
      top + menuHeight > viewportHeight - VIEWPORT_MARGIN &&
      rect.top - GAP - menuHeight >= VIEWPORT_MARGIN
    ) {
      top = rect.top - GAP - menuHeight;
    }

    const desiredLeft = align === "end" ? rect.right - menuWidth : rect.left;
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - menuWidth - VIEWPORT_MARGIN);
    const left = Math.min(Math.max(VIEWPORT_MARGIN, desiredLeft), maxLeft);

    setPosition({ top, left });
  }, [align]);

  // 打开后（Portal 已挂载到 DOM）立即测量并定位。
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  // 浮层脱离文档流后不受父级裁剪影响，但需要跟随滚动/缩放保持贴合。
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleChange = () => updatePosition();
    // 使用捕获阶段监听，以便感知任意可滚动祖先的滚动。
    window.addEventListener("scroll", handleChange, true);
    window.addEventListener("resize", handleChange);
    return () => {
      window.removeEventListener("scroll", handleChange, true);
      window.removeEventListener("resize", handleChange);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target)) {
        return;
      }
      // 浮层位于 Portal 中，不在 wrapper 内，需要单独判断。
      if (menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        wrapperRef.current
          ?.querySelector<HTMLButtonElement>("button")
          ?.focus();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <IconButton
        label={label}
        size="sm"
        active={open}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </IconButton>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={`${styles.menu} ${position ? "" : styles.hidden}`}
            style={position ? { top: position.top, left: position.left } : undefined}
            role="menu"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`${styles.item} ${item.danger ? styles.danger : ""}`}
                disabled={item.disabled}
                title={item.disabled ? item.disabledHint : undefined}
                onClick={() => {
                  if (item.disabled) {
                    return;
                  }
                  item.onSelect();
                  setOpen(false);
                }}
              >
                {item.icon && <span className={styles.icon}>{item.icon}</span>}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
