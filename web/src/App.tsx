import { useState } from "react";
import { api } from "./api/client";
import { Dashboard } from "./Dashboard";
import { Header } from "./components/Header";
import { useInspector } from "./hooks/useInspector";
import { useTheme } from "./hooks/useTheme";

// Server-backed mode (the Docker / Codespaces tool): polls the FastAPI backend
// and shows the server-only extras (the Under-the-hood SQL + raw rows dock).
export default function App() {
  const { theme, toggle } = useTheme();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { version, counts, writable, tree, edges, refresh } = useInspector(autoRefresh);

  const onReset = async () => {
    if (!window.confirm("Reset DB? This wipes and recreates the entire energydb schema (local only).")) return;
    try {
      await api.reset();
      refresh();
    } catch (e) {
      window.alert(String(e));
    }
  };

  return (
    <div className="app">
      <Header
        counts={counts}
        writable={writable}
        autoRefresh={autoRefresh}
        onToggleAuto={() => setAutoRefresh((a) => !a)}
        onRefresh={refresh}
        onReset={onReset}
        theme={theme}
        onToggleTheme={toggle}
      />
      <Dashboard mode="server" version={version} tree={tree} edges={edges} theme={theme} />
    </div>
  );
}
