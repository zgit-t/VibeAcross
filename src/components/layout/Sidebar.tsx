import { Info, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";
import { PRIMARY_NAV, SECONDARY_NAV } from "../../config/navigation";
import { APP_NAME } from "../../config/app";
import logo from "../../assets/logo.png";
import { IconButton } from "../ui/IconButton";
import { GlobalSearch } from "../../features/search/GlobalSearch";
import type { NavItem } from "../../config/navigation";
import styles from "./Sidebar.module.css";

/** 左侧主导航栏。支持折叠，折叠后保留图标与可访问名称。 */
export function Sidebar() {
  const { activeView, navigate, sidebarCollapsed, toggleSidebar, openAbout } =
    useApp();
  const { t } = useI18n();

  function renderItem(item: NavItem) {
    const active = activeView === item.id;
    const Icon = item.icon;
    const label = t(item.labelKey);
    return (
      <button
        key={item.id}
        type="button"
        className={`${styles.item} ${active ? styles.active : ""}`}
        aria-current={active ? "page" : undefined}
        title={sidebarCollapsed ? label : undefined}
        onClick={() => navigate(item.id)}
      >
        <Icon size={17} className={styles.itemIcon} aria-hidden="true" />
        <span className={styles.itemLabel}>{label}</span>
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
        <img
          className={styles.mark}
          src={logo}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <span className={styles.brandText}>{APP_NAME}</span>
        <IconButton
          label={
            sidebarCollapsed
              ? t("nav.expandSidebar")
              : t("nav.collapseSidebar")
          }
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

      <div className={styles.searchSlot}>
        <GlobalSearch />
      </div>

      <nav className={styles.nav} aria-label={t("nav.primary")}>
        {PRIMARY_NAV.map(renderItem)}
      </nav>

      <div className={styles.footer}>
        {SECONDARY_NAV.map(renderItem)}
        <button
          type="button"
          className={styles.item}
          title={sidebarCollapsed ? t("nav.about") : undefined}
          onClick={openAbout}
        >
          <Info size={17} className={styles.itemIcon} aria-hidden="true" />
          <span className={styles.itemLabel}>{t("nav.about")}</span>
        </button>
      </div>
    </aside>
  );
}
