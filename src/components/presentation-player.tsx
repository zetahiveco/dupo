import { useEffect, useState } from "react";
import type { DocProject } from "../doc-model";
import { PiCaretLeft, PiCaretRight, PiX } from "react-icons/pi";

export function PresentationPlayer({ project, onBack }: { project: DocProject; onBack: () => void }) {
  const [index, setIndex] = useState(0);
  const page = project.pages[index] ?? project.pages[0];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight") setIndex((i) => Math.min(project.pages.length - 1, i + 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (event.key === "Escape") onBack();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project.pages.length, onBack]);

  if (!page) return null;

  return (
    <div className="player-shell">
      <div className="player-top">
        <span className="zoom-label">{index + 1} / {project.pages.length}</span>
        <div className="toolbar-actions">
          <button className="icon-btn" title="Previous slide" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
            <PiCaretLeft size={16} />
          </button>
          <button className="icon-btn" title="Next slide" onClick={() => setIndex((i) => Math.min(project.pages.length - 1, i + 1))} disabled={index >= project.pages.length - 1}>
            <PiCaretRight size={16} />
          </button>
          <button className="icon-btn" title="Exit (Esc)" onClick={onBack}>
            <PiX size={16} />
          </button>
        </div>
      </div>
      <div className="player-stage">
        <div
          className="player-slide"
          style={{
            aspectRatio: `${project.width} / ${project.height}`,
            background: page.background,
            maxHeight: "86vh",
          }}
        >
          {page.shapes.filter((shape) => !shape.hidden).map((shape) => {
            const style: React.CSSProperties = {
              position: "absolute",
              left: `${(shape.x / project.width) * 100}%`,
              top: `${(shape.y / project.height) * 100}%`,
            };
            if (shape.kind === "text") {
              return (
                <div
                  key={shape.id}
                  style={{
                    ...style,
                    width: `${(shape.width / project.width) * 100}%`,
                    fontSize: `${(shape.fontSize / project.height) * 100}cqh`,
                    containerType: "size" as never,
                    color: shape.fill,
                    fontWeight: shape.fontStyle === "bold" ? 700 : 400,
                    fontStyle: shape.fontStyle === "italic" ? "italic" : "normal",
                    textAlign: shape.align ?? "left",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {shape.text}
                </div>
              );
            }
            if (shape.kind === "rect") {
              return (
                <div
                  key={shape.id}
                  style={{
                    ...style,
                    width: `${(shape.width / project.width) * 100}%`,
                    height: `${(shape.height / project.height) * 100}%`,
                    background: shape.fill,
                    borderRadius: `${((shape.cornerRadius ?? 0) / project.height) * 100}%`,
                  }}
                />
              );
            }
            if (shape.kind === "circle") {
              return (
                <div
                  key={shape.id}
                  style={{
                    ...style,
                    width: `${(shape.width / project.width) * 100}%`,
                    height: `${(shape.height / project.height) * 100}%`,
                    background: shape.fill,
                    borderRadius: "50%",
                  }}
                />
              );
            }
            if (shape.kind === "path") {
              return (
                <svg
                  key={shape.id}
                  viewBox={`0 0 ${shape.width} ${shape.height}`}
                  preserveAspectRatio="none"
                  style={{
                    ...style,
                    width: `${(shape.width / project.width) * 100}%`,
                    height: `${(shape.height / project.height) * 100}%`,
                    overflow: "visible",
                    pointerEvents: "none",
                  }}
                >
                  <path d={shape.data} fill={shape.fill ?? "none"} stroke={shape.stroke} strokeWidth={shape.strokeWidth} />
                </svg>
              );
            }
            return (
              <img
                key={shape.id}
                src={shape.src}
                alt=""
                style={{
                  ...style,
                  width: `${(shape.width / project.width) * 100}%`,
                  height: `${(shape.height / project.height) * 100}%`,
                  objectFit: "fill",
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
