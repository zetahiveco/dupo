import {
  PiArrowClockwise,
  PiArrowCounterClockwise,
  PiArrowDown,
  PiArrowUp,
  PiCircle,
  PiCaretLeft,
  PiCaretRight,
  PiCopy,
  PiCursor,
  PiHandGrabbing,
  PiImage,
  PiMagnifyingGlassMinus,
  PiMagnifyingGlassPlus,
  PiPen,
  PiPlus,
  PiRectangle,
  PiTrash,
} from "react-icons/pi";
import type { ShapeTool } from "./canvas-stage";

export type ToolMode = "select" | "text" | "rect";
export type EditorTool = "select" | "pan";

export function DocToolbar({
  tool,
  onToolChange,
  shapeTool,
  onShapeToolChange,
  pageIndex,
  pageCount,
  zoom,
  canUndo,
  canRedo,
  onZoomIn,
  onZoomOut,
  onAddPage,
  onDeletePage,
  onPrev,
  onNext,
  onUndo,
  onRedo,
  onStartText,
  onInsertImage,
  selectedId,
  onDeleteShape,
  onDuplicateShape,
  onLayerShape,
}: {
  tool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  shapeTool: ShapeTool | null;
  onShapeToolChange: (tool: ShapeTool | null) => void;
  selectedId: string;
  pageIndex: number;
  pageCount: number;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onAddPage: () => void;
  onDeletePage: () => void;
  onPrev: () => void;
  onNext: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onStartText: () => void;
  onInsertImage: () => void;
  onDeleteShape: () => void;
  onDuplicateShape: () => void;
  onLayerShape: (dir: "front" | "back") => void;
}) {
  function toggleShapeTool(next: ShapeTool) {
    onShapeToolChange(shapeTool === next ? null : next);
  }
  return (
    <div className="canvas-toolbar">
      <div className="toolbar-group">
        <button
          className={"icon-btn" + (tool === "select" ? " active" : "")}
          title="Pointer (select and edit)"
          onClick={() => onToolChange("select")}
        >
          <PiCursor size={16} />
        </button>
        <button
          className={"icon-btn" + (tool === "pan" ? " active" : "")}
          title="Pan (drag the canvas)"
          onClick={() => onToolChange("pan")}
        >
          <PiHandGrabbing size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button className="icon-btn" title="Undo" onClick={onUndo} disabled={!canUndo}>
          <PiArrowCounterClockwise size={16} />
        </button>
        <button className="icon-btn" title="Redo" onClick={onRedo} disabled={!canRedo}>
          <PiArrowClockwise size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button className="icon-btn" title="Add text" onClick={() => onStartText()}>
          <span className="tool-glyph" style={{ fontWeight: 700, fontSize: 14 }}>T</span>
        </button>
        <button
          className={"icon-btn" + (shapeTool === "rect" ? " active" : "")}
          title={shapeTool === "rect" ? "Rectangle tool active — drag on canvas (click again to cancel)" : "Rectangle — drag on canvas to draw"}
          onClick={() => toggleShapeTool("rect")}
        >
          <PiRectangle size={16} />
        </button>
        <button
          className={"icon-btn" + (shapeTool === "circle" ? " active" : "")}
          title={shapeTool === "circle" ? "Circle tool active — drag on canvas (click again to cancel)" : "Circle — drag on canvas to draw"}
          onClick={() => toggleShapeTool("circle")}
        >
          <PiCircle size={16} />
        </button>
        <button
          className={"icon-btn" + (shapeTool === "path" ? " active" : "")}
          title={shapeTool === "path" ? "Path tool active — click to place points, Shift locks 45°, Enter to finish" : "Path — click to place polygon points (Shift locks to 45°)"}
          onClick={() => toggleShapeTool("path")}
        >
          <PiPen size={16} />
        </button>
        <button className="icon-btn" title="Insert image" onClick={() => onInsertImage()}>
          <PiImage size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button
          className="icon-btn"
          title="Duplicate selected"
          onClick={onDuplicateShape}
          disabled={!selectedId}
        >
          <PiCopy size={16} />
        </button>
        <button
          className="icon-btn"
          title="Bring to front"
          onClick={() => onLayerShape("front")}
          disabled={!selectedId}
        >
          <PiArrowUp size={16} />
        </button>
        <button
          className="icon-btn"
          title="Send to back"
          onClick={() => onLayerShape("back")}
          disabled={!selectedId}
        >
          <PiArrowDown size={16} />
        </button>
        <button
          className="icon-btn danger"
          title="Delete selected"
          onClick={onDeleteShape}
          disabled={!selectedId}
        >
          <PiTrash size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button className="icon-btn" title="Previous page" onClick={onPrev} disabled={pageIndex === 0}>
          <PiCaretLeft size={16} />
        </button>
        <span className="page-indicator">
          {pageIndex + 1} / {pageCount}
        </span>
        <button
          className="icon-btn"
          title="Next page"
          onClick={onNext}
          disabled={pageIndex >= pageCount - 1}
        >
          <PiCaretRight size={16} />
        </button>
        <button className="icon-btn" title="Add page" onClick={onAddPage}>
          <PiPlus size={16} />
        </button>
        <button
          className="icon-btn danger"
          title="Delete page"
          onClick={onDeletePage}
          disabled={pageCount <= 1}
        >
          <PiTrash size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button className="icon-btn" title="Zoom out" onClick={onZoomOut}>
          <PiMagnifyingGlassMinus size={16} />
        </button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="icon-btn" title="Zoom in" onClick={onZoomIn}>
          <PiMagnifyingGlassPlus size={16} />
        </button>
      </div>
    </div>
  );
}
