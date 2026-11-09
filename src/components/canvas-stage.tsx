import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Ellipse, Line, Circle, Path as KonvaPath, Transformer } from "react-konva";
import type Konva from "konva";
import type { CanvasShape, Page } from "../doc-model";

export type ShapeTool = "rect" | "circle" | "path";

type DrawPayload = { kind: ShapeTool; x: number; y: number; width: number; height: number; data?: string };

type Props = {
  page: Page;
  width: number;
  height: number;
  zoom: number;
  selectedId: string;
  interactive?: boolean;
  shapeTool?: ShapeTool | null;
  onDrawShape?: (draw: DrawPayload) => void;
  draft?: EditDraft;
  onDraftChange?: (draft: EditDraft) => void;
  onSelect: (id: string) => void;
  onChange: (shapes: CanvasShape[], commit: boolean) => void;
  onContextMenu?: (info: { screenX: number; screenY: number; pageX: number; pageY: number; shapeId: string }) => void;
  stageRef?: React.RefObject<Konva.Stage | null>;
};

type EditDraft = { id: string; value: string } | null;

export function CanvasStage({
  page,
  width,
  height,
  zoom,
  selectedId,
  interactive = true,
  shapeTool = null,
  onDrawShape,
  draft: draftProp,
  onDraftChange,
  onSelect,
  onChange,
  onContextMenu,
  stageRef,
}: Props) {
  const [draftInternal, setDraftInternal] = useState<EditDraft>(null);
  const draft = draftProp !== undefined ? draftProp : draftInternal;
  const setDraft = (next: EditDraft) => {
    if (onDraftChange) onDraftChange(next);
    else setDraftInternal(next);
  };
  const transformerRef = useRef<Konva.Transformer>(null);
  const localStageRef = useRef<Konva.Stage | null>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const [drawBox, setDrawBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [penPoints, setPenPoints] = useState<{ x: number; y: number }[] | null>(null);
  const [penCursor, setPenCursor] = useState<{ x: number; y: number } | null>(null);
  const penPointsRef = useRef<{ x: number; y: number }[] | null>(null);
  const [images, setImages] = useState(new Map<string, HTMLImageElement>());
  const selectedShape = page.shapes.find((s) => s.id === selectedId) ?? null;
  const locked = selectedShape?.locked === true;
  const stage = stageRef ?? localStageRef;

  useEffect(() => {
    penPointsRef.current = penPoints;
  }, [penPoints]);

  useEffect(() => {
    const container = stage.current?.container();
    if (container) container.style.cursor = shapeTool ? "crosshair" : "";
  }, [shapeTool, stage]);

  // Finish or cancel the polygon pen with Enter/Escape.
  useEffect(() => {
    if (shapeTool !== "path") return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      const points = penPointsRef.current;
      if (points && points.length >= 2) finishPen(points, false);
      else {
        setPenPoints(null);
        setPenCursor(null);
        penPointsRef.current = null;
      }
    }
    // Capture phase: commit/clear the pen before other Escape handlers react.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeTool]);

  const sources = page.shapes
    .filter((s): s is Extract<CanvasShape, { kind: "image" }> => s.kind === "image")
    .map((s) => s.src)
    .join("|");

  useEffect(() => {
    for (const src of sources.split("|")) {
      if (!src || images.has(src)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => setImages((cache) => new Map(cache).set(src, img));
      img.src = src;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const node = nodeRefs.current.get(selectedId);
    tr.nodes(node && node.getStage() ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, page.shapes, zoom, draft]);

  function readShapes(): CanvasShape[] {
    const shapes: CanvasShape[] = [];
    for (const shape of page.shapes) {
      const node = nodeRefs.current.get(shape.id);
      if (!node) {
        // Hidden shapes have no node — keep them untouched.
        shapes.push(shape);
        continue;
      }
      const rotation = Math.round(node.rotation() * 10) / 10;
      const opacity = node.opacity();
      const extras = {
        rotation: rotation ? rotation : undefined,
        opacity: opacity < 1 ? opacity : undefined,
      };
      if (shape.kind === "text") {
        shapes.push({
          ...shape,
          ...extras,
          x: node.x(),
          y: node.y(),
          width: Math.max(24, Math.round(node.width() * node.scaleX())),
        });
      } else if (shape.kind === "circle") {
        const boxWidth = Math.max(8, Math.round(node.width() * node.scaleX()));
        const boxHeight = Math.max(8, Math.round(node.height() * node.scaleY()));
        shapes.push({
          ...shape,
          ...extras,
          x: Math.round(node.x() - boxWidth / 2),
          y: Math.round(node.y() - boxHeight / 2),
          width: boxWidth,
          height: boxHeight,
        });
      } else if (shape.kind === "path") {
        shapes.push({
          ...shape,
          ...extras,
          x: Math.round(node.x()),
          y: Math.round(node.y()),
          scaleX: Math.round(node.scaleX() * 1000) / 1000,
          scaleY: Math.round(node.scaleY() * 1000) / 1000,
        });
      } else {
        shapes.push({
          ...shape,
          ...extras,
          x: node.x(),
          y: node.y(),
          width: Math.max(8, Math.round(node.width() * node.scaleX())),
          height: Math.max(8, Math.round(node.height() * node.scaleY())),
        });
      }
    }
    return shapes;
  }

  const preview = () => onChange(readShapes(), false);
  const commit = () => onChange(readShapes(), true);

  function bind(node: Konva.Node | null, id: string) {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  }

  function pointerPagePoint(stage: Konva.Stage | null): { x: number; y: number } | null {
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    return { x: pointer.x / zoom, y: pointer.y / zoom };
  }

  function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }) {
    return {
      x: Math.round(Math.min(a.x, b.x)),
      y: Math.round(Math.min(a.y, b.y)),
      width: Math.round(Math.abs(b.x - a.x)),
      height: Math.round(Math.abs(b.y - a.y)),
    };
  }

  function snapPenPoint(last: { x: number; y: number }, cursor: { x: number; y: number }, shift: boolean) {
    if (!shift) return cursor;
    const angle = Math.atan2(cursor.y - last.y, cursor.x - last.x);
    const snapped = (Math.round(angle / (Math.PI / 4)) * Math.PI / 4);
    const distance = Math.hypot(cursor.x - last.x, cursor.y - last.y);
    return { x: last.x + Math.cos(snapped) * distance, y: last.y + Math.sin(snapped) * distance };
  }

  function finishPen(points: { x: number; y: number }[], close: boolean) {
    setPenPoints(null);
    setPenCursor(null);
    penPointsRef.current = null;
    if (!onDrawShape) return;
    const pts = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) >= 1);
    if (pts.length < 2) return;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const data =
      pts.map((p, i) => `${i === 0 ? "M" : "L"} ${Math.round(p.x - minX)} ${Math.round(p.y - minY)}`).join(" ") +
      (close ? " Z" : "");
    onDrawShape({
      kind: "path",
      x: Math.round(minX),
      y: Math.round(minY),
      width: Math.max(8, Math.round(Math.max(...xs) - minX)),
      height: Math.max(8, Math.round(Math.max(...ys) - minY)),
      data,
    });
  }

  return (
    <div className="stage-wrap">
      <Stage
        ref={stage}
        width={width * zoom}
        height={height * zoom}
        scaleX={zoom}
        scaleY={zoom}
        listening={interactive}
        onMouseDown={(event) => {
          // Transformer anchor names, so drawing never starts on a handle.
          const targetName = typeof event.target.name === "function" ? event.target.name() : "";
          const isAnchor = !!targetName && /^(tl|tr|bl|br|ml|mr|mt|mb|rotater)$/.test(targetName);
          if (shapeTool === "path" && !isAnchor) {
            const point = pointerPagePoint(event.target.getStage());
            if (!point) return;
            const points = penPointsRef.current;
            if (!points) {
              const first = [point];
              penPointsRef.current = first;
              setPenPoints(first);
              return;
            }
            // Clicking near the first anchor closes the polygon.
            const firstPoint = points[0];
            const hitRadius = 10 / zoom;
            if (points.length >= 3 && Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y) < hitRadius) {
              finishPen([...points, firstPoint], true);
              return;
            }
            const last = points[points.length - 1];
            const next = [...points, snapPenPoint(last, point, event.evt.shiftKey)];
            penPointsRef.current = next;
            setPenPoints(next);
            return;
          }
          if (shapeTool && !isAnchor) {
            const point = pointerPagePoint(event.target.getStage());
            if (point) {
              drawStartRef.current = point;
              onSelect("");
            }
            return;
          }
          if (event.target === event.target.getStage() || event.target === event.target.getStage()?.getLayers()[0]?.getChildren()[0]) {
            onSelect("");
          }
        }}
        onTouchStart={(event) => {
          if (event.target === event.target.getStage()) onSelect("");
        }}
        onMouseMove={(event) => {
          if (shapeTool === "path" && penPointsRef.current) {
            const point = pointerPagePoint(event.target.getStage());
            if (!point) return;
            const points = penPointsRef.current;
            setPenCursor(snapPenPoint(points[points.length - 1], point, event.evt.shiftKey));
            return;
          }
          if (!drawStartRef.current) return;
          const point = pointerPagePoint(event.target.getStage());
          if (!point) return;
          setDrawBox(normalizeRect(drawStartRef.current, point));
        }}
        onMouseUp={(event) => {
          if (shapeTool === "path") return;
          const start = drawStartRef.current;
          if (!start || !shapeTool) return;
          drawStartRef.current = null;
          const point = pointerPagePoint(event.target.getStage()) ?? start;
          const rect = normalizeRect(start, point);
          setDrawBox(null);
          if (!onDrawShape) return;
          if (rect.width < 8 || rect.height < 8) {
            const defaultWidth = Math.round(Math.min(width * 0.3, 280));
            const defaultHeight = Math.round(Math.min(height * 0.25, 200));
            onDrawShape({
              kind: shapeTool,
              x: Math.round(Math.max(0, Math.min(point.x - defaultWidth / 2, width - defaultWidth))),
              y: Math.round(Math.max(0, Math.min(point.y - defaultHeight / 2, height - defaultHeight))),
              width: defaultWidth,
              height: defaultHeight,
            });
          } else {
            onDrawShape({ kind: shapeTool, ...rect });
          }
        }}
        onDblClick={(event) => {
          // Swallow double-clicks so they don't select/deselect during pen drawing.
          if (shapeTool === "path") event.evt.preventDefault();
        }}
        onContextMenu={(event) => {
          if (!onContextMenu) return;
          const stage = event.target.getStage();
          const pointer = stage?.getPointerPosition();
          if (!stage || !pointer) return;
          event.evt.preventDefault();
          let node: Konva.Node | null = event.target;
          let shapeId = "";
          while (node && node !== stage) {
            for (const shape of page.shapes) {
              if (nodeRefs.current.get(shape.id) === node) {
                shapeId = shape.id;
                break;
              }
            }
            if (shapeId) break;
            node = node.getParent();
          }
          if (shapeId) onSelect(shapeId);
          else onSelect("");
          onContextMenu({
            screenX: event.evt.clientX,
            screenY: event.evt.clientY,
            pageX: Math.round(pointer.x / zoom),
            pageY: Math.round(pointer.y / zoom),
            shapeId,
          });
        }}
      >
        <Layer>
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill={page.background}
            shadowColor="#000"
            shadowBlur={20}
            shadowOpacity={0.22}
            isBackground={true}
            onMouseDown={() => onSelect("")}
          />
          {page.shapes.filter((shape) => !shape.hidden).map((shape) => renderShape(shape))}
          {drawBox && drawStartRef.current ? (
            shapeTool === "circle" ? (
              <Ellipse
                x={drawBox.x + drawBox.width / 2}
                y={drawBox.y + drawBox.height / 2}
                radiusX={drawBox.width / 2}
                radiusY={drawBox.height / 2}
                stroke="#3a86ff"
                strokeWidth={1.5}
                dash={[6, 4]}
                listening={false}
              />
            ) : (
              <Rect
                x={drawBox.x}
                y={drawBox.y}
                width={drawBox.width}
                height={drawBox.height}
                stroke="#3a86ff"
                strokeWidth={1.5}
                dash={[6, 4]}
                listening={false}
              />
            )
          ) : null}
          {penPoints && penPoints.length > 0 ? (
            <>
              <Line
                points={penPoints.flatMap((p) => [p.x, p.y])}
                stroke="#3a86ff"
                strokeWidth={1.5}
                listening={false}
              />
              {penCursor ? (
                <Line
                  points={[penPoints[penPoints.length - 1].x, penPoints[penPoints.length - 1].y, penCursor.x, penCursor.y]}
                  stroke="#3a86ff"
                  strokeWidth={1.5}
                  dash={[5, 4]}
                  listening={false}
                />
              ) : null}
              {penPoints.map((point, index) => (
                <KonvaCircleAnchor key={index} point={point} first={index === 0} />
              ))}
              {penCursor ? <KonvaCircleAnchor point={penCursor} first={false} ghost /> : null}
            </>
          ) : null}
          <Transformer
            ref={transformerRef}
            rotateEnabled={!locked}
            resizeEnabled={!locked}
            borderStroke="#3a86ff"
            anchorStroke="#3a86ff"
            anchorFill="#ffffff"
            anchorSize={8}
            boundBoxFunc={(_old, box) => ({ ...box, width: Math.max(8, box.width), height: Math.max(8, box.height) })}
          />
        </Layer>
      </Stage>
      {draft ? <TextEditOverlay draft={draft} page={page} zoom={zoom} onDone={finishEdit} /> : null}
    </div>
  );

  function finishEdit(id: string, value: string) {
    setDraft(null);
    onChange(
      page.shapes.map((shape) => (shape.id === id && shape.kind === "text" ? { ...shape, text: value } : shape)),
      true,
    );
  }

  function renderShape(shape: CanvasShape) {
    const shared = {
      x: shape.x,
      y: shape.y,
      rotation: shape.rotation ?? 0,
      opacity: shape.opacity ?? 1,
      draggable: !shape.locked && !draft,
    };
    if (shape.kind === "text") {
      return (
        <Text
          key={shape.id}
          ref={(node: Konva.Text | null) => bind(node, shape.id)}
          {...shared}
          text={draft?.id === shape.id ? draft.value : shape.text}
          width={shape.width}
          fontSize={shape.fontSize}
          fill={shape.fill}
          fontStyle={shape.fontStyle ?? "normal"}
          fontFamily={shape.fontFamily ?? "Inter, system-ui, sans-serif"}
          align={shape.align ?? "left"}
          onDblClick={() => { if (!shape.locked) setDraft({ id: shape.id, value: shape.text }); }}
          onDblTap={() => { if (!shape.locked) setDraft({ id: shape.id, value: shape.text }); }}
          onMouseDown={() => onSelect(shape.id)}
          onTap={() => onSelect(shape.id)}
          onDragStart={() => onSelect(shape.id)}
          onDragMove={preview}
          onDragEnd={commit}
          onTransform={(event) => {
            const node = event.target as Konva.Text;
            node.setAttrs({ width: Math.max(24, node.width() * node.scaleX()), scaleX: 1, scaleY: 1 });
          }}
          onTransformEnd={commit}
        />
      );
    }
    if (shape.kind === "rect") {
      return (
        <Rect
          key={shape.id}
          ref={(node: Konva.Rect | null) => bind(node, shape.id)}
          {...shared}
          width={shape.width}
          height={shape.height}
          fill={shape.fill}
          stroke={shape.stroke}
          strokeWidth={shape.stroke ? (shape.strokeWidth ?? 2) : 0}
          cornerRadius={shape.cornerRadius ?? 0}
          onMouseDown={() => onSelect(shape.id)}
          onTap={() => onSelect(shape.id)}
          onDragStart={() => onSelect(shape.id)}
          onDragMove={preview}
          onDragEnd={commit}
          onTransform={(event) => {
            const node = event.target as Konva.Rect;
            node.setAttrs({
              width: Math.max(8, node.width() * node.scaleX()),
              height: Math.max(8, node.height() * node.scaleY()),
              scaleX: 1,
              scaleY: 1,
            });
          }}
          onTransformEnd={commit}
        />
      );
    }
    if (shape.kind === "circle") {
      return (
        <Ellipse
          key={shape.id}
          ref={(node: Konva.Ellipse | null) => bind(node, shape.id)}
          {...shared}
          x={shape.x + shape.width / 2}
          y={shape.y + shape.height / 2}
          radiusX={shape.width / 2}
          radiusY={shape.height / 2}
          fill={shape.fill}
          stroke={shape.stroke}
          strokeWidth={shape.stroke ? (shape.strokeWidth ?? 2) : 0}
          onMouseDown={() => onSelect(shape.id)}
          onTap={() => onSelect(shape.id)}
          onDragStart={() => onSelect(shape.id)}
          onDragMove={preview}
          onDragEnd={commit}
          onTransform={(event) => {
            const node = event.target as Konva.Ellipse;
            node.setAttrs({
              radiusX: Math.max(8, (node.width() * node.scaleX()) / 2),
              radiusY: Math.max(8, (node.height() * node.scaleY()) / 2),
              scaleX: 1,
              scaleY: 1,
            });
          }}
          onTransformEnd={commit}
        />
      );
    }
    if (shape.kind === "path") {
      return (
        <KonvaPath
          key={shape.id}
          ref={(node: Konva.Path | null) => bind(node, shape.id)}
          {...shared}
          data={shape.data}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          fill={shape.fill}
          scaleX={shape.scaleX ?? 1}
          scaleY={shape.scaleY ?? 1}
          hitStrokeWidth={Math.max(12, shape.strokeWidth * 3)}
          onMouseDown={() => onSelect(shape.id)}
          onTap={() => onSelect(shape.id)}
          onDragStart={() => onSelect(shape.id)}
          onDragMove={preview}
          onDragEnd={commit}
          onTransformEnd={commit}
        />
      );
    }
    return (
      <KonvaImage
        key={shape.id}
        ref={(node: Konva.Image | null) => bind(node, shape.id)}
        {...shared}
        width={shape.width}
        height={shape.height}
        image={images.get(shape.src) ?? undefined}
        onMouseDown={() => onSelect(shape.id)}
        onTap={() => onSelect(shape.id)}
        onDragStart={() => onSelect(shape.id)}
        onDragMove={preview}
        onDragEnd={commit}
        onTransform={(event) => {
          const node = event.target as Konva.Node;
          node.setAttrs({
            width: Math.max(8, node.width() * node.scaleX()),
            height: Math.max(8, node.height() * node.scaleY()),
            scaleX: 1,
            scaleY: 1,
          });
        }}
        onTransformEnd={commit}
      />
    );
  }
}

function KonvaCircleAnchor({ point, first, ghost = false }: { point: { x: number; y: number }; first: boolean; ghost?: boolean }) {
  return (
    <Circle
      x={point.x}
      y={point.y}
      radius={ghost ? 3.5 : 4.5}
      fill={ghost ? "rgba(58,134,255,0.35)" : first ? "#3a86ff" : "#ffffff"}
      stroke="#3a86ff"
      strokeWidth={1.5}
      listening={false}
    />
  );
}

function TextEditOverlay({
  draft,
  page,
  zoom,
  onDone,
}: {
  draft: NonNullable<EditDraft>;
  page: Page;
  zoom: number;
  onDone: (id: string, value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const shape = page.shapes.find((s) => s.id === draft.id);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  if (!shape || shape.kind !== "text") return null;
  return (
    <textarea
      className="text-edit"
      ref={ref}
      defaultValue={draft.value}
      style={{
        left: shape.x * zoom,
        top: shape.y * zoom,
        width: Math.max(120, shape.width * zoom),
        fontSize: shape.fontSize * zoom,
        color: shape.fill,
        fontFamily: shape.fontFamily ?? "Inter, system-ui, sans-serif",
        fontWeight: shape.fontStyle === "bold" ? 700 : 400,
        fontStyle: shape.fontStyle === "italic" ? "italic" : "normal",
        textAlign: shape.align ?? "left",
      }}
      onBlur={(event) => onDone(draft.id, event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone(draft.id, draft.value);
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          onDone(draft.id, (event.target as HTMLTextAreaElement).value);
        }
      }}
    />
  );
}
