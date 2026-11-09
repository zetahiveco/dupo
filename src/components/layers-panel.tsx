import { useEffect, useRef, useState } from "react";
import {
  PiArrowDown,
  PiArrowUp,
  PiCircle,
  PiEye,
  PiEyeSlash,
  PiImage,
  PiLockSimple,
  PiLockSimpleOpen,
  PiPen,
  PiRectangle,
  PiStack,
  PiTextT,
  PiTrash,
} from "react-icons/pi";
import type { CanvasShape } from "../doc-model";

function kindLabel(shape: CanvasShape): string {
  if (shape.kind === "rect") return "Rectangle";
  if (shape.kind === "circle") return "Circle";
  if (shape.kind === "path") return "Path";
  if (shape.kind === "image") return "Image";
  return "Text";
}

function layerLabel(shape: CanvasShape): string {
  if (shape.name?.trim()) return shape.name.trim();
  if (shape.kind === "text") return shape.text.trim().slice(0, 28) || "Text";
  return kindLabel(shape);
}

function layerIcon(shape: CanvasShape) {
  const size = 13;
  if (shape.kind === "text") return <PiTextT size={size} />;
  if (shape.kind === "rect") return <PiRectangle size={size} />;
  if (shape.kind === "circle") return <PiCircle size={size} />;
  if (shape.kind === "path") return <PiPen size={size} />;
  return <PiImage size={size} />;
}

export function LayersPanel({
  shapes,
  selectedId,
  onSelect,
  onPatch,
  onDelete,
  onReorder,
}: {
  shapes: CanvasShape[];
  selectedId: string;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<CanvasShape>) => void;
  onDelete: (id: string) => void;
  onReorder: (id: string, direction: "up" | "down") => void;
}) {
  // Layer order display matches Figma: the topmost layer is the first row.
  const ordered = [...shapes].reverse();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) renameRef.current?.select();
  }, [renamingId]);

  function commitRename() {
    if (renamingId) {
      const name = renameValue.trim().slice(0, 60);
      onPatch(renamingId, { name: name || undefined });
    }
    setRenamingId(null);
  }

  return (
    <div className="layers-panel">
      <div className="panel-title">
        <PiStack size={13} /> Layers {shapes.length ? <span className="layer-count">{shapes.length}</span> : null}
      </div>
      <div className="layers-list">
        {ordered.map((shape) => (
          <div
            key={shape.id}
            className={
              "layer-row" +
              (shape.id === selectedId ? " selected" : "") +
              (shape.hidden ? " hidden-layer" : "")
            }
            onClick={() => onSelect(shape.id)}
            onDoubleClick={() => {
              setRenamingId(shape.id);
              setRenameValue(shape.name ?? (shape.kind === "text" ? shape.text.trim().slice(0, 28) : kindLabel(shape)));
            }}
            title="Double-click to rename"
          >
            <button
              className="layer-btn"
              title={shape.hidden ? "Show layer" : "Hide layer"}
              onClick={(event) => {
                event.stopPropagation();
                onPatch(shape.id, { hidden: !shape.hidden });
              }}
            >
              {shape.hidden ? <PiEyeSlash size={13} /> : <PiEye size={13} />}
            </button>
            <span className="layer-icon">{layerIcon(shape)}</span>
            {renamingId === shape.id ? (
              <input
                ref={renameRef}
                className="layer-rename"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={commitRename}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename();
                  if (event.key === "Escape") setRenamingId(null);
                }}
              />
            ) : (
              <span className="layer-name">{layerLabel(shape)}</span>
            )}
            <span className="layer-actions">
              <button
                className="layer-btn"
                title={shape.locked ? "Unlock layer" : "Lock layer"}
                onClick={(event) => {
                  event.stopPropagation();
                  onPatch(shape.id, { locked: !shape.locked });
                }}
              >
                {shape.locked ? <PiLockSimple size={12} /> : <PiLockSimpleOpen size={12} />}
              </button>
              <button
                className="layer-btn"
                title="Bring forward"
                onClick={(event) => {
                  event.stopPropagation();
                  onReorder(shape.id, "up");
                }}
              >
                <PiArrowUp size={12} />
              </button>
              <button
                className="layer-btn"
                title="Send backward"
                onClick={(event) => {
                  event.stopPropagation();
                  onReorder(shape.id, "down");
                }}
              >
                <PiArrowDown size={12} />
              </button>
              <button
                className="layer-btn layer-delete"
                title="Delete layer"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(shape.id);
                }}
              >
                <PiTrash size={12} />
              </button>
            </span>
          </div>
        ))}
        {ordered.length === 0 ? <div className="layers-empty">Nothing on this page yet</div> : null}
      </div>
    </div>
  );
}
