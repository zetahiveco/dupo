import { useCallback, useEffect, useState } from "react";
import { getSnapshot, pickFolder, pickFile, reloadProjects, saveSettings, readProject, createProject, deleteProject } from "./api";
import { errorMessage, type ProjectKind, type ProjectMeta, type Settings, type Snapshot } from "./types";
import { Sidebar } from "./components/sidebar";
import { StartScreen } from "./components/start-screen";
import { SettingsDialog } from "./components/settings-dialog";
import { DocEditor } from "./components/doc-editor";
import { VideoEditor } from "./components/video-editor";
import { PresentationPlayer } from "./components/presentation-player";
import { parseDoc } from "./doc-model";
import { parseVideo } from "./video-model";

type Route =
  | { view: "start" }
  | { view: "doc"; meta: ProjectMeta; raw: string }
  | { view: "present"; meta: ProjectMeta; raw: string }
  | { view: "video"; meta: ProjectMeta; raw: string };

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>({ view: "start" });
  const [showSettings, setShowSettings] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProjectMeta | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getSnapshot();
      setSnap(next);
      if (route.view === "start") {
        const projects = await reloadProjects(next.settings.projectsFolder);
        setSnap({ ...next, projects });
      }
    } catch (error) {
      setBootError(errorMessage(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const theme = snap?.settings.theme ?? "dark";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dupo-theme", theme);
  }, [snap?.settings.theme]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setShowSettings(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!snap) {
    return (
      <div className="boot">
        <div>{bootError ?? "Loading…"}</div>
      </div>
    );
  }

  async function handleCreate(kind: ProjectKind, name: string, preset: string, width: number, height: number) {
    try {
      const meta = await createProject(kind, name, preset, width, height);
      const raw = await readProject(meta.path);
      setRoute(
        kind === "videos"
          ? { view: "video", meta, raw }
          : { view: "doc", meta, raw },
      );
      await refresh();
    } catch (error) {
      setBootError(errorMessage(error));
    }
  }

  async function handleOpenPath() {
    try {
      const picked = await pickFile([{ name: "Dupo project", extensions: ["dupo"] }]);
      if (!picked) return;
      const raw = await readProject(picked);
      openRaw(picked, raw);
    } catch (error) {
      setBootError(errorMessage(error));
    }
  }

  function openRaw(path: string, raw: string) {
    const name = path.split(/[\\/]/).pop()?.replace(/\.dupo$/, "") ?? "Project";
    const doc = parseDoc(raw);
    const video = doc ? null : parseVideo(raw);
    const kind: ProjectKind = doc ? doc.kind : video ? "videos" : "documents";
    const meta: ProjectMeta = {
      id: path,
      path,
      kind,
      name,
      width: doc?.width ?? video?.width ?? 1080,
      height: doc?.height ?? video?.height ?? 1080,
      updatedAt: Date.now(),
    };
    if (kind === "videos") setRoute({ view: "video", meta, raw });
    else setRoute({ view: "doc", meta, raw });
  }

  async function openMeta(meta: ProjectMeta) {
    try {
      const raw = await readProject(meta.path);
      if (meta.kind === "videos") setRoute({ view: "video", meta, raw });
      else setRoute({ view: "doc", meta, raw });
    } catch (error) {
      setBootError(errorMessage(error));
    }
  }

  async function chooseFolder() {
    const folder = await pickFolder("Choose a projects folder");
    if (!folder || !snap) return;
    const next = await saveSettings({ ...snap.settings, projectsFolder: folder });
    setSnap(next);
  }

  async function saveSettingsAndClose(settings: Settings) {
    try {
      const next = await saveSettings(settings);
      setSnap(next);
    } catch (error) {
      setBootError(errorMessage(error));
    }
    setShowSettings(false);
  }

  const sidebar = (
    <Sidebar
      projects={snap.projects}
      currentPath={route.view !== "start" ? route.meta.path : null}
      onOpen={(meta) => void openMeta(meta)}
      onDelete={(meta) => setPendingDelete(meta)}
      onOpenSettings={() => setShowSettings(true)}
    />
  );

  return (
    <div className="shell">
      {sidebar}
      <main className="main">
        {route.view === "start" ? (
          <>
            <StartScreen
              onCreate={(kind, name, preset, width, height) => void handleCreate(kind, name, preset, width, height)}
              onOpenPath={() => void handleOpenPath()}
              onPickFolder={() => void chooseFolder()}
              projectsFolder={snap.settings.projectsFolder}
              error={bootError}
            />
          </>
        ) : route.view === "doc" ? (
          <DocEditor
            key={route.meta.path}
            project={parseDoc(route.raw) ?? { version: 1, kind: route.meta.kind === "presentations" ? "presentations" : "documents", name: route.meta.name, preset: "custom", width: route.meta.width, height: route.meta.height, pages: [] }}
            path={route.meta.path}
            onBack={() => {
              setRoute({ view: "start" });
              void refresh();
            }}
          />
        ) : route.view === "present" ? (
          <PresentationPlayer
            project={parseDoc(route.raw) ?? { version: 1, kind: "presentations", name: route.meta.name, preset: "custom", width: route.meta.width, height: route.meta.height, pages: [] }}
            onBack={() => {
              setRoute({ view: "start" });
              void refresh();
            }}
          />
        ) : (
          <VideoEditor
            key={route.meta.path}
            meta={route.meta}
            raw={route.raw}
            onBack={() => {
              setRoute({ view: "start" });
              void refresh();
            }}
          />
        )}
      </main>
      {showSettings ? (
        <SettingsDialog
          snap={snap}
          onSave={(settings) => void saveSettingsAndClose(settings)}
          onStart={() => {
            try {
              void (async () => {
                const { mcpStart } = await import("./api");
                setSnap({ ...snap, mcp: await mcpStart() });
              })();
            } catch (error) {
              setBootError(errorMessage(error));
            }
          }}
          onStop={async () => {
            try {
              const { mcpStop } = await import("./api");
              setSnap({ ...snap, mcp: await mcpStop() });
            } catch (error) {
              setBootError(errorMessage(error));
            }
          }}
          onClose={() => setShowSettings(false)}
          onPickFolder={() => void chooseFolder()}
        />
      ) : null}
      {pendingDelete ? (
        <div className="dialog-backdrop" onClick={() => setPendingDelete(null)}>
          <div className="dialog" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-head">
              <strong>Delete “{pendingDelete.name}”?</strong>
            </div>
            <p className="muted-note">This removes the .dupo file from disk. It cannot be undone.</p>
            <div className="dialog-actions">
              <button className="text-btn" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button
                className="primary-btn danger"
                onClick={async () => {
                  try {
                    await deleteProject(pendingDelete.path);
                    setPendingDelete(null);
                    setRoute({ view: "start" });
                    await refresh();
                  } catch (error) {
                    setBootError(errorMessage(error));
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
