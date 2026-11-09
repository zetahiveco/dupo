import { useMemo, useState } from "react";
import { PAGE_PRESETS, presetGroups } from "../page-presets";
import type { ProjectKind } from "../types";

const KIND_TITLES: Record<ProjectKind, string> = {
  documents: "Document",
  presentations: "Presentation",
  videos: "Video",
};

const KIND_GROUPS: Record<ProjectKind, string[]> = {
  documents: ["Social", "Print", "Custom"],
  presentations: ["Presentation", "Custom"],
  videos: ["Video", "Custom"],
};

export function StartScreen({
  onCreate,
  onOpenPath,
  onPickFolder,
  projectsFolder,
  error,
}: {
  onCreate: (kind: ProjectKind, name: string, preset: string, width: number, height: number) => void;
  onOpenPath: () => void;
  onPickFolder: () => void;
  projectsFolder: string;
  error: string | null;
}) {
  const [kind, setKind] = useState<ProjectKind>("documents");
  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState("linkedin-post");
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  const groups = useMemo(
    () => presetGroups().filter((group) => KIND_GROUPS[kind].includes(group)),
    [kind],
  );
  const grouped = PAGE_PRESETS.filter((preset) => groups.includes(preset.group))
    .map((preset) => ({
      label: `${preset.label} · ${preset.width} × ${preset.height}`,
      value: preset.id,
      group: preset.group,
    }));
  const custom = presetId === "custom";

  function choosePreset(id: string) {
    const preset = PAGE_PRESETS.find((p) => p.id === id);
    setPresetId(id);
    if (preset) {
      setWidth(preset.width);
      setHeight(preset.height);
    }
  }

  return (
    <div className="start-shell">
      <div className="start-card">
        <header className="start-head">
          <div className="brand">
            <span className="brand-mark">d</span>
            <span>dupo</span>
          </div>
          <button className="text-btn" onClick={onPickFolder} title="Choose the folder projects are saved in">
            Folder: {projectsFolder || "…"}
          </button>
        </header>
        <h1>What are you making?</h1>
        <div className="field-row">
          <label className="field-label" htmlFor="project-name">Name</label>
          <input
            id="project-name"
            className="field"
            placeholder="Project name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim()) onCreate(kind, name.trim(), presetId, width, height);
            }}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="project-kind">Type</label>
          <select
            id="project-kind"
            className="field"
            value={kind}
            onChange={(event) => {
              const next = event.target.value as ProjectKind;
              setKind(next);
              const fallback = next === "presentations" ? "slide-16x9" : next === "videos" ? "video-1080p" : "linkedin-post";
              const preset = PAGE_PRESETS.find((p) => p.id === fallback);
              if (preset) {
                setPresetId(preset.id);
                setWidth(preset.width);
                setHeight(preset.height);
              }
            }}
          >
            {(Object.keys(KIND_TITLES) as ProjectKind[]).map((kindKey) => (
              <option key={kindKey} value={kindKey}>{KIND_TITLES[kindKey]}</option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="page-size">Page size</label>
          <select
            id="page-size"
            className="field"
            value={presetId}
            onChange={(event) => choosePreset(event.target.value)}
          >
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {grouped.filter((preset) => preset.group === group).map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {custom ? (
            <div className="field-row-inline">
              <input
                className="field"
                type="number"
                aria-label="Width in pixels"
                value={width}
                min={16}
                onChange={(event) => setWidth(Math.max(16, Number(event.target.value) || 0))}
              />
              <span className="field-label">×</span>
              <input
                className="field"
                type="number"
                aria-label="Height in pixels"
                value={height}
                min={16}
                onChange={(event) => setHeight(Math.max(16, Number(event.target.value) || 0))}
              />
              <span className="field-label">px</span>
            </div>
          ) : null}
        </div>
        <div className="start-actions">
          <button className="primary-btn" disabled={!name.trim()} onClick={() => onCreate(kind, name.trim(), presetId, width, height)}>
            Create
          </button>
          <button className="text-btn" onClick={onOpenPath}>
            Open a .dupo file
          </button>
        </div>
        {error ? <div className="form-error">{error}</div> : null}
      </div>
    </div>
  );
}
