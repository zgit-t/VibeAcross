import { AppProvider } from "./context/AppContext";
import { I18nProvider } from "./i18n";
import { RevisionProvider } from "./context/RevisionContext";
import { ProjectsProvider } from "./context/ProjectsContext";
import { ToolsProvider } from "./context/ToolsContext";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import { AppShell } from "./components/layout/AppShell";

export function App() {
  return (
    <AppProvider>
      <I18nProvider>
        <RevisionProvider>
          <ProjectsProvider>
            <ToolsProvider>
              <WorkspaceProvider>
                <AppShell />
              </WorkspaceProvider>
            </ToolsProvider>
          </ProjectsProvider>
        </RevisionProvider>
      </I18nProvider>
    </AppProvider>
  );
}
