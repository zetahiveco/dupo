import { useEffect, useState } from "react";
import type { McpStatus, Settings, Snapshot } from "../types";
import { PiCopy, PiX } from "react-icons/pi";

export function SettingsDialog({
  snap,
  onSave,
  onStart,
  onStop,
  onClose,
  onPickFolder,
}: {
  snap: Snapshot;
  onSave: (settings: Settings) => void;
  onStart: () => void;
  onStop: () => void;
  onClose: () => void;
  onPickFolder: () => void;
}) {
  const [projectsFolder, setProjectsFolder] = useState(snap.settings.projectsFolder);
  const [theme, setTheme] = useState(snap.settings.theme);
  const [mcp, setMcp] = useState<McpStatus>(snap.mcp);
  const [busy, setBusy] = useState(false);

  useEffect(() => setMcp(snap.mcp), [snap.mcp]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <strong>Settings</strong>
          <button className="icon-btn" onClick={onClose} title="Close">
            <PiX size={16} />
          </button>
        </div>

        <div className="field-row">
          <label className="field-label">Projects folder</label>
          <div className="field-row-inline">
            <input className="field" value={projectsFolder} onChange={(event) => setProjectsFolder(event.target.value)} />
            <button className="text-btn" onClick={onPickFolder}>
              Browse
            </button>
          </div>
        </div>

        <div className="field-row">
          <label className="field-label">Theme</label>
          <select className="field" value={theme} onChange={(event) => setTheme(event.target.value === "light" ? "light" : "dark")}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>

        <div className="field-row">
          <label className="field-label">MCP server</label>
          <div className="mcp-box">
            <div className="mcp-status">
              <span className={"mcp-dot" + (mcp.running ? " on" : "")} />
              {mcp.running ? `Running on ${mcp.url}` : "Stopped"}
            </div>
            <div className="toolbar-actions mcp-actions">
              <button
                className="primary-btn"
                onClick={() => {
                  setBusy(true);
                  onStart();
                  setBusy(false);
                }}
                disabled={busy || mcp.running}
              >
                Start
              </button>
              <button
                className="text-btn secondary-btn"
                onClick={() => {
                  setBusy(true);
                  onStop();
                  setBusy(false);
                }}
                disabled={busy || !mcp.running}
              >
                Stop
              </button>
            </div>
          </div>
        </div>

        {mcp.running ? (
          <div className="field-row">
            <label className="field-label">Connect an agent</label>
            <div className="mcp-commands">
              {[
                { label: "Claude", value: mcp.claude },
                { label: "Codex", value: mcp.codex },
                { label: "OpenCode", value: mcp.opencode },
              ].map((row) => (
                <div key={row.label} className="mcp-command">
                  <code>{row.value}</code>
                  <button
                    className="icon-btn"
                    title={`Copy ${row.label} command`}
                    onClick={() => void navigator.clipboard.writeText(row.value)}
                  >
                    <PiCopy size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="dialog-actions">
          <button className="text-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-btn"
            onClick={() =>
              onSave({
                projectsFolder: projectsFolder.trim(),
                theme: theme === "light" ? "light" : "dark",
                mcpEnabled: snap.settings.mcpEnabled,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
