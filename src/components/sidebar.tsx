import type { ProjectKind, ProjectMeta } from "../types";
import { formatDate } from "../types";
import { PiArticle, PiGear, PiMonitor, PiPresentation, PiTrash } from "react-icons/pi";

const KIND_ICON: Record<ProjectKind, React.ReactNode> = {
  documents: <PiArticle size={16} />,
  presentations: <PiPresentation size={16} />,
  videos: <PiMonitor size={16} />,
};

export function Sidebar({
  projects,
  currentPath,
  onOpen,
  onDelete,
  onOpenSettings,
}: {
  projects: ProjectMeta[];
  currentPath: string | null;
  onOpen: (meta: ProjectMeta) => void;
  onDelete: (meta: ProjectMeta) => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-mark">d</span>
          <span>dupo</span>
        </div>
        <div className="sidebar-actions">
          <button className="icon-btn" title="Settings" onClick={onOpenSettings}>
            <PiGear size={16} />
          </button>
        </div>
      </div>
      <div className="panel-title sidebar-section">Projects</div>
      <div className="tree-scroll">
        {projects.length === 0 ? (
          <div className="empty-note">No projects yet. Create one from the start screen.</div>
        ) : (
          projects.map((meta) => (
            <div
              key={meta.path}
              className={"tree-row" + (currentPath === meta.path ? " active" : "")}
              onClick={() => onOpen(meta)}
              title={meta.path}
            >
              <span className="tree-icon">{KIND_ICON[meta.kind]}</span>
              <span className="tree-name">{meta.name}</span>
              <span className="tree-meta">{formatDate(meta.updatedAt)}</span>
              <button
                className="icon-btn tree-action"
                title="Delete project"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(meta);
                }}
              >
                <PiTrash size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
