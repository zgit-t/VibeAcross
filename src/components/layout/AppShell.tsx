import { useApp } from "../../context/AppContext";
import { AboutDialog } from "../AboutDialog";
import { UpdateReadyDialog } from "../../features/update/UpdateReadyDialog";
import { Sidebar } from "./Sidebar";
import { OverviewPage } from "../../pages/OverviewPage";
import { ProjectsPage } from "../../pages/ProjectsPage";
import { ToolsPage } from "../../pages/ToolsPage";
import { TutorialsPage } from "../../pages/TutorialsPage";
import { TasksPage } from "../../pages/TasksPage";
import { SessionsPage } from "../../pages/SessionsPage";
import { SettingsPage } from "../../pages/SettingsPage";
import type { ViewId } from "../../types/navigation";
import styles from "./AppShell.module.css";

function renderView(view: ViewId) {
  switch (view) {
    case "overview":
      return <OverviewPage />;
    case "projects":
      return <ProjectsPage />;
    case "tools":
      return <ToolsPage />;
    case "tutorials":
      return <TutorialsPage />;
    case "tasks":
      return <TasksPage />;
    case "sessions":
      return <SessionsPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <OverviewPage />;
  }
}

/** 应用外壳：左侧导航 + 右侧内容区 + 全局弹窗。 */
export function AppShell() {
  const { activeView } = useApp();

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <div className={styles.content}>{renderView(activeView)}</div>
      </main>
      <AboutDialog />
      <UpdateReadyDialog />
    </div>
  );
}
