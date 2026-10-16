import { Info, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { PRIMARY_NAV, SECONDARY_NAV } from "../../config/navigation";
import { APP_NAME } from "../../config/app";
import { IconButton } from "../ui/IconButton";
import type { NavItem } from "../../config/navigation";
import styles from "./Sidebar.module.css";

/** 左侧主导航栏。支持折叠，折叠后保留图标与可访问名称。 */
export function Sidebar() {
  const { activeView, navigate, sidebarCollapsed, toggleSidebar, openAbout } =
    useApp();

  function renderItem(item: NavItem) {
    const active = activeView === item.id;
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        className={`${styles.item} ${active ? styles.active : ""}`}
        aria-current={active ? "page" : undefined}
        title={sidebarCollapsed ? item.label : undefined}
        onClick={() => navigate(item.id)}
      >
        <Icon size={17} className={styles.itemIcon} aria-hidden="true" />
        <span className={styles.itemLabel}>{item.label}</span>
      </button>
    );
  }

  return (
    <aside
      className={`${styles.sidebar} ${
        sidebarCollapsed ? styles.collapsed : ""
      }`}
    >
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden="true">
          VA
        </span>
        <span className={styles.brandText}>{APP_NAME}</span>
        <IconButton
          label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
          size="sm"
          className={styles.collapseButton}
          onClick={toggleSidebar}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={16} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={16} aria-hidden="true" />
          )}
        </IconButton>
      </div>

      <nav className={styles.nav} aria-label="主导航">
        {PRIMARY_NAV.map(renderItem)}
      </nav>

      <div className={styles.footer}>
        {SECONDARY_NAV.map(renderItem)}
        <button
          type="button"
          className={styles.item}
          title={sidebarCollapsed ? "About" : undefined}
          onClick={openAbout}
        >
          <Info size={17} className={styles.itemIcon} aria-hidden="true" />
          <span className={styles.itemLabel}>About</span>
        </button>
      </div>
    </aside>
  );
}
