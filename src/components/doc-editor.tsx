import { useCallback, useEffect, useRef, useState } from "react";
import type Konva from "konva";
import {
  PiArrowDown,
  PiArrowUp,
  PiCircle,
  PiClipboard,
  PiCopy,
  PiImage,
  PiLockSimple,
  PiLockSimpleOpen,
  PiRectangle,
  PiTextT,
  PiTrash,
  PiX,
} from "react-icons/pi";
import { CanvasStage, type ShapeTool } from "./canvas-stage";
import { LayersPanel } from "./layers-panel";

type EditDraft = { id: string; value: string } | null;
import { DocToolbar } from "./doc-toolbar";
import { InsertPanel } from "./insert-panel";
import { PageStrip } from "./page-strip";
import { ContextMenu, type MenuState } from "./context-menu";
import { blankPage, nextId, safeColor, type CanvasShape, type DocProject, type Page } from "../doc-model";
import { presetById } from "../page-presets";
import { pickFile, writeProject, IMAGE_MAX_BYTES, importMedia } from "../api";
import { errorMessage } from "../types";
import { renderPageToBase64Png } from "../page-renderer";

type Props = {
  project: DocProject;
  path: string;
  onBack: () => void;
};

type SnapshotState = { past: Page[][]; future: Page[][] };

export function DocEditor({ project, path, onBack }: Props) {
  const [pages, setPages] = useState<Page[]>(project.pages);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<"select" | "pan">("select");
  const [shapeTool, setShapeTool] = useState<ShapeTool | null>(null);
  const [draft, setDraft] = useState<EditDraft>(null);
  const [history, setHistory] = useState<SnapshotState>({ past: [], future: [] });
  const [exporting, setExporting] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState("");
  const stageRef = useRef<Konva.Stage | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const panRef = useRef<{ pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const clipboardRef = useRef<CanvasShape | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);

  const page = pages[pageIndex] ?? pages[0];
  const preset = presetById(project.preset);

  useEffect(() => {
    if (wrapRef.current) {
      const padding = 96;
      const scale = Math.min(
        (wrapRef.current.clientWidth - padding) / project.width,
        (wrapRef.current.clientHeight - padding) / project.height,
        1,
      );
      setZoom(Math.max(0.05, Math.round(scale * 100) / 100));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setZoom((z) => {
        const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
        return Math.min(4, Math.max(0.05, Math.round(z * factor * 100) / 100));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const save = useCallback(
    (nextPages: Page[]) => {
      setDirty(true);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        const payload: DocProject = { ...project, pages: nextPages };
        try {
          await writeProject(path, JSON.stringify(payload, null, 2));
          setDirty(false);
        } catch {
          setToast("Could not save");
        }
      }, 600);
    },
    [path, project],
  );

  function record(next: Page[]) {
    setHistory((h) => ({ past: [...h.past, pages].slice(-40), future: [] }));
    setPages(next);
    save(next);
  }

  function onShapesChange(shapes: CanvasShape[], commit: boolean) {
    const next = pages.map((p, i) => (i === pageIndex ? { ...p, shapes } : p));
    if (commit) record(next);
    else setPages(next);
  }

  function patchSelected(patch: Partial<CanvasShape>) {
    if (!page || !selectedId) return;
    const next = pages.map((p, i) =>
      i === pageIndex
        ? { ...p, shapes: p.shapes.map((s) => (s.id === selectedId ? ({ ...s, ...patch } as CanvasShape) : s)) }
        : p,
    );
    record(next);
  }

  function patchShape(id: string, patch: Partial<CanvasShape>) {
    const next = pages.map((p, i) =>
      i === pageIndex
        ? { ...p, shapes: p.shapes.map((s) => (s.id === id ? ({ ...s, ...patch } as CanvasShape) : s)) }
        : p,
    );
    record(next);
  }

  function deleteShape(id: string) {
    record(pages.map((p, i) => (i === pageIndex ? { ...p, shapes: p.shapes.filter((s) => s.id !== id) } : p)));
    if (selectedId === id) setSelectedId("");
  }

  function reorderShape(id: string, direction: "up" | "down") {
    const shapes = page?.shapes ?? [];
    const index = shapes.findIndex((s) => s.id === id);
    if (index < 0) return;
    // "up" moves the shape toward the front (later in the array).
    const target = direction === "up" ? index + 1 : index - 1;
    if (target < 0 || target >= shapes.length) return;
    const reordered = [...shapes];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    record(pages.map((p, i) => (i === pageIndex ? { ...p, shapes: reordered } : p)));
  }

  function deleteSelected() {
    if (!page || !selectedId) return;
    record(pages.map((p, i) => (i === pageIndex ? { ...p, shapes: p.shapes.filter((s) => s.id !== selectedId) } : p)));
    setSelectedId("");
  }

  function duplicateSelected() {
    if (!page || !selectedId) return;
    const source = page.shapes.find((s) => s.id === selectedId);
    if (!source) return;
    const copy = { ...source, id: nextId(), x: source.x + 24, y: source.y + 24 } as CanvasShape;
    const next = pages.map((p, i) => (i === pageIndex ? { ...p, shapes: [...p.shapes, copy] } : p));
    record(next);
    setSelectedId(copy.id);
  }

  function layerSelected(dir: "front" | "back") {
    if (!page || !selectedId) return;
    const shape = page.shapes.find((s) => s.id === selectedId);
    if (!shape) return;
    const rest = page.shapes.filter((s) => s.id !== selectedId);
    const shapes = dir === "front" ? [...rest, shape] : [shape, ...rest];
    record(pages.map((p, i) => (i === pageIndex ? { ...p, shapes } : p)));
  }

  function undo() {
    setHistory((h) => {
      const previous = h.past[h.past.length - 1];
      if (!previous) return h;
      setPages(previous);
      save(previous);
      return { past: h.past.slice(0, -1), future: [pages, ...h.future].slice(0, 40) };
    });
  }

  function redo() {
    setHistory((h) => {
      const next = h.future[0];
      if (!next) return h;
      setPages(next);
      save(next);
      return { past: [...h.past, pages].slice(-40), future: h.future.slice(1) };
    });
  }

  function addText(at?: { x: number; y: number }) {
    if (!page) return;
    const atPoint = at && Number.isFinite(at.x) && Number.isFinite(at.y) ? at : undefined;
    const width = Math.round(project.width * 0.6);
    const shape: CanvasShape = {
      id: nextId(),
      kind: "text",
      x: atPoint
        ? Math.round(Math.min(Math.max(0, atPoint.x - width / 2), project.width - width))
        : Math.round(project.width * 0.2),
      y: atPoint
        ? Math.round(Math.max(0, atPoint.y - 30))
        : Math.round(project.height * 0.4),
      width,
      text: "Your text here",
      fontSize: Math.max(24, Math.round(project.height * 0.05)),
      fill: "#1f2430",
      align: "left",
    };
    record(pages.map((p, i) => (i === pageIndex ? { ...p, shapes: [...p.shapes, shape] } : p)));
    setSelectedId(shape.id);
  }

  function addRect(at?: { x: number; y: number }) {
    if (!page) return;
    const atPoint = at && Number.isFinite(at.x) && Number.isFinite(at.y) ? at : undefined;
    const width = Math.round(Math.min(project.width * 0.3, 280));
    const height = Math.round(Math.min(project.height * 0.25, 200));
    insertRect({
      x: atPoint
        ? Math.round(Math.min(Math.max(0, atPoint.x - width / 2), project.width - width))
        : Math.round(project.width * 0.3),
      y: atPoint
        ? Math.round(Math.min(Math.max(0, atPoint.y - height / 2), project.height - height))
        : Math.round(project.height * 0.3),
      width,
      height,
    });
  }

  function insertRect(rect: { x: number; y: number; width: number; height: number }) {
    if (!page) return;
    const shape: CanvasShape = {
      id: nextId(),
      kind: "rect",
      ...rect,
      fill: "#3a86ff",
      cornerRadius: 12,
    };
    record(pages.map((p, i) => (i === pageIndex ? { ...p, shapes: [...p.shapes, shape] } : p)));
    setSelectedId(shape.id);
  }

  function insertCircle(rect: { x: number; y: number; width: number; height: number }) {
    if (!page) return;
    const shape: CanvasShape = {
      id: nextId(),
      kind: "circle",
      ...rect,
      fill: "#3a86ff",
    };
    record(pages.map((p, i) => (i === pageIndex ? { ...p, shapes: [...p.shapes, shape] } : p)));
    setSelectedId(shape.id);
  }

  function insertPath(rect: { x: number; y: number; width: number; height: number; data: string }) {
    if (!page) return;
    const shape: CanvasShape = {
      id: nextId(),
      kind: "path",
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      data: rect.data,
      stroke: "#1f2430",
      strokeWidth: 4,
    };
    record(pages.map((p, i) => (i === pageIndex ? { ...p, shapes: [...p.shapes, shape] } : p)));
    setSelectedId(shape.id);
  }

  function copyShape() {
    const shape = page?.shapes.find((s) => s.id === selectedId);
    if (!shape) return;
    clipboardRef.current = JSON.parse(JSON.stringify(shape)) as CanvasShape;
    setToast("Copied");
  }

  function pasteShape(at?: { x: number; y: number }) {
    const source = clipboardRef.current;
    if (!page || !source) return;
    const copy = { ...source, id: nextId() } as CanvasShape;
    if (at) {
      const height = source.kind === "text" ? estimateTextHeight(source) : (source.height ?? 0);
      copy.x = Math.round(Math.min(Math.max(0, at.x - source.width / 2), project.width - source.width));
      copy.y = Math.round(Math.min(Math.max(0, at.y), project.height - height));
    } else {
      copy.x = source.x + 24;
      copy.y = source.y + 24;
    }
    record(pages.map((p, i) => (i === pageIndex ? { ...p, shapes: [...p.shapes, copy] } : p)));
    setSelectedId(copy.id);
  }

  function alignSelected(edge: "left" | "centerH" | "right" | "top" | "middle" | "bottom") {
    if (!page || !selectedId) return;
    const shape = page.shapes.find((s) => s.id === selectedId);
    if (!shape) return;
    const height = shape.kind === "text" ? estimateTextHeight(shape) : shape.height ?? 0;
    const patch: Partial<CanvasShape> = {};
    if (edge === "left") patch.x = 0;
    if (edge === "centerH") patch.x = Math.round((project.width - shape.width) / 2);
    if (edge === "right") patch.x = Math.round(project.width - shape.width);
    if (edge === "top") patch.y = 0;
    if (edge === "middle") patch.y = Math.round((project.height - height) / 2);
    if (edge === "bottom") patch.y = Math.round(project.height - height);
    patchSelected(patch);
  }

  function estimateTextHeight(shape: CanvasShape): number {
    if (shape.kind !== "text") return shape.height ?? 0;
    const lines = shape.text.split("\n").length;
    return lines * shape.fontSize * 1.2;
  }

  function openShapeMenu(info: { screenX: number; screenY: number; pageX: number; pageY: number; shapeId: string }) {
    const shape = page?.shapes.find((s) => s.id === info.shapeId);
    const at = { x: info.pageX, y: info.pageY };
    const items = shape
      ? [
          { label: "Copy", icon: <PiClipboard size={14} />, onSelect: () => copyShape() },
          { label: "Duplicate", icon: <PiCopy size={14} />, onSelect: () => duplicateSelected() },
          { label: "Bring to front", icon: <PiArrowUp size={14} />, onSelect: () => layerSelected("front") },
          { label: "Send to back", icon: <PiArrowDown size={14} />, onSelect: () => layerSelected("back") },
          {
            label: shape.locked ? "Unlock" : "Lock",
            icon: shape.locked ? <PiLockSimpleOpen size={14} /> : <PiLockSimple size={14} />,
            onSelect: () => patchSelected({ locked: !shape.locked }),
          },
          { label: "Paste here", icon: <PiClipboard size={14} />, disabled: !clipboardRef.current, onSelect: () => pasteShape(at) },
          { label: "Delete", icon: <PiTrash size={14} />, danger: true, onSelect: () => deleteSelected() },
        ]
      : [
          { label: "Add text", icon: <PiTextT size={14} />, onSelect: () => addText(at) },
          { label: "Add rectangle", icon: <PiRectangle size={14} />, onSelect: () => addRect(at) },
          {
            label: "Add circle",
            icon: <PiCircle size={14} />,
            onSelect: () => {
              const width = Math.round(Math.min(project.width * 0.3, 280));
              const height = Math.round(Math.min(project.height * 0.25, 200));
              insertCircle({
                x: Math.round(Math.min(Math.max(0, at.x - width / 2), project.width - width)),
                y: Math.round(Math.min(Math.max(0, at.y - height / 2), project.height - height)),
                width,
                height,
              });
            },
          },
          { label: "Add image", icon: <PiImage size={14} />, onSelect: () => void addImage() },
          { label: "Paste here", icon: <PiClipboard size={14} />, disabled: !clipboardRef.current, onSelect: () => pasteShape(at) },
        ];
    setMenu({ screenX: info.screenX, screenY: info.screenY, items });
  }

  async function addImage() {
    if (!page) return;
    try {
      const picked = await pickFile([{ name: "Image", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }]);
      if (!picked) return;
      const storedPath = await importMedia(picked, IMAGE_MAX_BYTES);
      const shape: CanvasShape = {
        id: nextId(),
        kind: "image",
        x: Math.round(project.width * 0.2),
        y: Math.round(project.height * 0.2),
        width: Math.round(project.width * 0.6),
        height: Math.round(project.height * 0.4),
        src: `media://localhost/${encodeURIComponent(storedPath)}`,
      };
      record(pages.map((p, i) => (i === pageIndex ? { ...p, shapes: [...p.shapes, shape] } : p)));
      setSelectedId(shape.id);
    } catch (error) {
      setToast(errorMessage(error) || "Could not add the image");
    }
  }

  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
    }

    function onKey(event: KeyboardEvent) {
      if (menu || isTyping(event.target)) return;
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (meta && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (!selectedId) {
        if (event.key === "Escape") {
          setSelectedId("");
          setShapeTool(null);
          setDraft(null);
        }
        return;
      }
      if (event.key === "Escape") {
        setShapeTool(null);
        setDraft(null);
      }
      if (event.key === "Enter") {
        const target = page?.shapes.find((s) => s.id === selectedId);
        if (target?.kind === "text" && !draft) {
          event.preventDefault();
          setDraft({ id: target.id, value: target.text });
          return;
        }
      }
      if (meta && key === "d") {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (meta && event.key === "]") {
        event.preventDefault();
        layerSelected("front");
        return;
      }
      if (meta && event.key === "[") {
        event.preventDefault();
        layerSelected("back");
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (event.key === "Escape") {
        setSelectedId("");
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      const shape = page?.shapes.find((s) => s.id === selectedId);
      if (!shape) return;
      const delta =
        event.key === "ArrowLeft" ? [-step, 0] :
        event.key === "ArrowRight" ? [step, 0] :
        event.key === "ArrowUp" ? [0, -step] :
        event.key === "ArrowDown" ? [0, step] : null;
      if (!delta) return;
      event.preventDefault();
      patchSelected({ x: shape.x + delta[0], y: shape.y + delta[1] });
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, selectedId, page, pages, pageIndex, history, draft]);

  async function exportAs(format: "pdf" | "pptx" | "png") {
    setExporting(format.toUpperCase());
    try {
      const pngs: string[] = [];
      for (const page of pages) {
        pngs.push(await renderPageToBase64Png(project, page));
      }
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("export_project", {
        request: { path, format, pages: pngs, name: project.name },
      });
      setToast(`Exported as ${format.toUpperCase()}`);
    } catch (error) {
      setToast(errorMessage(error) || `Export to ${format.toUpperCase()} failed`);
    } finally {
      setExporting(null);
    }
  }

  if (!page) return null;

  return (
    <div className="editor-shell">
      <div className="editor-topbar">
        <button className="icon-btn" title="Back to projects" onClick={onBack}>
          <PiX size={16} />
        </button>
        <div className="editor-title">
          <strong>{project.name}</strong>
          {preset ? <span className="muted-note">{preset.label}</span> : null}
          <span className="muted-note">{project.width} × {project.height} px</span>
          {dirty ? <span className="muted-note">Saving…</span> : null}
        </div>
        <div className="toolbar-actions" />
      </div>
      <DocToolbar
        tool={tool}
        onToolChange={(next) => {
          setTool(next);
          if (next === "pan") setShapeTool(null);
        }}
        shapeTool={shapeTool}
        onShapeToolChange={setShapeTool}
        pageIndex={pageIndex}
        pageCount={pages.length}
        zoom={zoom}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onZoomIn={() => setZoom((z) => Math.min(4, z * 1.15))}
        onZoomOut={() => setZoom((z) => Math.max(0.05, z / 1.15))}
        onAddPage={() => {
          const next = [...pages.slice(0, pageIndex + 1), blankPage(), ...pages.slice(pageIndex + 1)];
          record(next);
          setPageIndex(pageIndex + 1);
        }}
        onDeletePage={() => {
          if (pages.length <= 1) return;
          record(pages.filter((_, i) => i !== pageIndex));
          setPageIndex((i) => Math.max(0, i - 1));
        }}
        onPrev={() => setPageIndex((i) => Math.max(0, i - 1))}
        onNext={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}
        selectedId={selectedId}
        onUndo={undo}
        onRedo={redo}
        onStartText={addText}
        onInsertImage={addImage}
        onDeleteShape={deleteSelected}
        onDuplicateShape={duplicateSelected}
        onLayerShape={layerSelected}
      />
      <div className="editor-body">
        <div
          className={"canvas-scroll" + (tool === "pan" ? " panning" : "")}
          ref={wrapRef}
          onPointerDown={
            tool === "pan"
              ? (event) => {
                  const el = event.currentTarget;
                  panRef.current = {
                    pointerId: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    scrollLeft: el.scrollLeft,
                    scrollTop: el.scrollTop,
                  };
                  el.setPointerCapture(event.pointerId);
                }
              : undefined
          }
          onPointerMove={
            tool === "pan"
              ? (event) => {
                  const pan = panRef.current;
                  if (!pan || pan.pointerId !== event.pointerId) return;
                  const el = event.currentTarget;
                  el.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
                  el.scrollTop = pan.scrollTop - (event.clientY - pan.y);
                }
              : undefined
          }
          onPointerUp={
            tool === "pan"
              ? (event) => {
                  if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
                }
              : undefined
          }
          onPointerCancel={
            tool === "pan"
              ? (event) => {
                  if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
                }
              : undefined
          }
        >
          <CanvasStage
            page={page}
            width={project.width}
            height={project.height}
            zoom={zoom}
            selectedId={selectedId}
            interactive={tool === "select"}
            shapeTool={shapeTool && tool === "select" ? shapeTool : null}
            onDrawShape={(draw) => {
              setShapeTool(null);
              if (draw.kind === "rect") insertRect(draw);
              else if (draw.kind === "circle") insertCircle(draw);
              else if (draw.data) insertPath({ ...draw, data: draw.data });
            }}
            onSelect={(id) => {
              // While a draw tool is active, clicks draw instead of selecting.
              if (!shapeTool) setSelectedId(id);
            }}
            onChange={onShapesChange}
            draft={draft}
            onDraftChange={setDraft}
            onContextMenu={openShapeMenu}
            stageRef={stageRef}
          />
        </div>
        <div className="right-rail">
          <LayersPanel
            shapes={page.shapes}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPatch={patchShape}
            onDelete={deleteShape}
            onReorder={reorderShape}
          />
          <InsertPanel
            background={safeColor(page.background, "#ffffff")}
            onBackground={(color) => record(pages.map((p, i) => (i === pageIndex ? { ...p, background: color } : p)))}
            onExport={exportAs}
            exporting={exporting}
            selected={page?.shapes.find((s) => s.id === selectedId) ?? null}
            onPatch={patchSelected}
            onAlign={alignSelected}
          />
        </div>
      </div>
      <PageStrip
        pages={pages}
        project={project}
        index={pageIndex}
        onSelect={setPageIndex}
        onAdd={() => {
          const next = [...pages, blankPage()];
          record(next);
          setPageIndex(next.length - 1);
        }}
        onPageMenu={(index, screenX, screenY) => {
          setMenu({
            screenX,
            screenY,
            items: [
              {
                label: "Duplicate page",
                icon: <PiCopy size={14} />,
                onSelect: () => {
                  const source = pages[index];
                  const copy: Page = { ...JSON.parse(JSON.stringify(source)), id: nextId() };
                  const next = [...pages.slice(0, index + 1), copy, ...pages.slice(index + 1)];
                  record(next);
                  setPageIndex(index + 1);
                },
              },
              {
                label: "Delete page",
                icon: <PiTrash size={14} />,
                danger: true,
                disabled: pages.length <= 1,
                onSelect: () => {
                  record(pages.filter((_, i) => i !== index));
                  setPageIndex((i) => Math.max(0, Math.min(i, pages.length - 2)));
                },
              },
            ],
          });
        }}
      />
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
