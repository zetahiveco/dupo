import { PiPlus } from "react-icons/pi";
import type { CanvasShape, DocProject, Page } from "../doc-model";

const THUMB_HEIGHT = 64;

export function PageStrip({
  pages,
  project,
  index,
  onSelect,
  onAdd,
  onPageMenu,
}: {
  pages: Page[];
  project: DocProject;
  index: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onPageMenu?: (index: number, screenX: number, screenY: number) => void;
}) {
  const thumbWidth = Math.max(40, Math.round((THUMB_HEIGHT * project.width) / project.height));
  const scale = thumbWidth / project.width;

  return (
    <div className="page-strip">
      {pages.map((page, i) => (
        <div key={page.id} className="page-thumb-item">
          <button
            className={"page-thumb" + (i === index ? " active" : "")}
            style={{ width: thumbWidth, height: THUMB_HEIGHT }}
            onClick={() => onSelect(i)}
            onContextMenu={(event) => {
              if (!onPageMenu) return;
              event.preventDefault();
              onSelect(i);
              onPageMenu(i, event.clientX, event.clientY);
            }}
            title={`Page ${i + 1}`}
          >
            {page.shapes.filter((shape) => !shape.hidden).map((shape) => (
              <ThumbShape key={shape.id} shape={shape} scale={scale} />
            ))}
          </button>
          <span className="page-num">{i + 1}</span>
        </div>
      ))}
      <div className="page-thumb-item">
        <button
          className="page-thumb-add"
          style={{ width: thumbWidth, height: THUMB_HEIGHT }}
          onClick={onAdd}
          title="Add a new page"
        >
          <PiPlus size={14} />
          Add page
        </button>
        <span className="page-num" />
      </div>
    </div>
  );
}

function ThumbShape({ shape, scale }: { shape: CanvasShape; scale: number }) {
  const base = {
    left: shape.x * scale,
    top: shape.y * scale,
    width: Math.max(1, shape.width * scale),
    opacity: shape.opacity ?? 1,
    transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
  };
  if (shape.kind === "text") {
    return (
      <div
        style={{
          ...base,
          fontSize: Math.max(3, shape.fontSize * scale),
          lineHeight: 1.2,
          color: shape.fill,
          fontWeight: shape.fontStyle === "bold" ? 700 : 400,
          fontStyle: shape.fontStyle === "italic" ? "italic" : "normal",
          textAlign: shape.align ?? "left",
          whiteSpace: "pre-wrap",
          overflow: "hidden",
        }}
      >
        {shape.text}
      </div>
    );
  }
  if (shape.kind === "rect") {
    return (
      <div
        style={{
          ...base,
          height: Math.max(1, shape.height * scale),
          background: shape.fill,
          borderRadius: shape.cornerRadius ? shape.cornerRadius * scale : 0,
        }}
      />
    );
  }
  if (shape.kind === "circle") {
    return (
      <div
        style={{
          ...base,
          height: Math.max(1, shape.height * scale),
          background: shape.fill,
          borderRadius: "50%",
        }}
      />
    );
  }
  if (shape.kind === "path") {
    return (
      <svg
        width={Math.max(1, shape.width * scale)}
        height={Math.max(1, shape.height * scale)}
        viewBox={`0 0 ${shape.width} ${shape.height}`}
        style={{
          ...base,
          height: Math.max(1, shape.height * scale),
          position: "absolute",
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
      src={shape.src}
      alt=""
      draggable={false}
      style={{
        ...base,
        height: Math.max(1, shape.height * scale),
        objectFit: "fill",
      }}
    />
  );
}
