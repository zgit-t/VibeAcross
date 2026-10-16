import { AppProvider } from "./context/AppContext";
import { ActivityProvider } from "./context/ActivityContext";
import { ProjectsProvider } from "./context/ProjectsContext";
import { ToolsProvider } from "./context/ToolsContext";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import { AppShell } from "./components/layout/AppShell";

export function App() {
  return (
    <AppProvider>
      <ActivityProvider>
        <ProjectsProvider>
          <ToolsProvider>
            <WorkspaceProvider>
              <AppShell />
            </WorkspaceProvider>
          </ToolsProvider>
        </ProjectsProvider>
      </ActivityProvider>
    </AppProvider>
  );
}
