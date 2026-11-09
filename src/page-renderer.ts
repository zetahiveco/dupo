import Konva from "konva";
import type { CanvasShape, DocProject, Page } from "./doc-model";

// Renders pages off-screen with Konva and returns base64 PNG payloads
// (no data: prefix) for the Rust export pipeline.

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  let cached = imageCache.get(src);
  if (!cached) {
    cached = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load media: ${src}`));
      img.src = src;
    });
    imageCache.set(src, cached);
  }
  return cached;
}

let renderHost: HTMLDivElement | null = null;

function getHost(): HTMLDivElement {
  if (!renderHost) {
    renderHost = document.createElement("div");
    renderHost.style.cssText = "position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;";
    document.body.appendChild(renderHost);
  }
  return renderHost;
}

function buildNode(shape: CanvasShape, image: HTMLImageElement | null): Konva.Shape {
  const shared = {
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation ?? 0,
    opacity: shape.opacity ?? 1,
  };
  if (shape.kind === "text") {
    return new Konva.Text({
      ...shared,
      width: shape.width,
      text: shape.text,
      fontSize: shape.fontSize,
      fill: shape.fill,
      fontStyle: shape.fontStyle ?? "normal",
      fontFamily: shape.fontFamily ?? "Inter, system-ui, sans-serif",
      align: shape.align ?? "left",
    });
  }
  if (shape.kind === "rect") {
    return new Konva.Rect({
      ...shared,
      width: shape.width,
      height: shape.height,
      fill: shape.fill,
      cornerRadius: shape.cornerRadius ?? 0,
      stroke: shape.stroke,
      strokeWidth: shape.stroke ? (shape.strokeWidth ?? 2) : 0,
    });
  }
  if (shape.kind === "circle") {
    return new Konva.Ellipse({
      ...shared,
      x: shape.x + shape.width / 2,
      y: shape.y + shape.height / 2,
      radiusX: shape.width / 2,
      radiusY: shape.height / 2,
      fill: shape.fill,
      stroke: shape.stroke,
      strokeWidth: shape.stroke ? (shape.strokeWidth ?? 2) : 0,
    });
  }
  if (shape.kind === "path") {
    return new Konva.Path({
      ...shared,
      data: shape.data,
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth,
      fill: shape.fill,
      scaleX: shape.scaleX ?? 1,
      scaleY: shape.scaleY ?? 1,
    });
  }
  return new Konva.Image({
    ...shared,
    width: shape.width,
    height: shape.height,
    image: image ?? undefined,
  });
}

export async function renderPageToBase64Png(project: DocProject, page: Page, pixelRatio = 2): Promise<string> {
  // Preload all images up front so nothing renders blank.
  const imageNodes = new Map<string, HTMLImageElement>();
  for (const shape of page.shapes) {
    if (shape.kind !== "image" || imageNodes.has(shape.src)) continue;
    try {
      imageNodes.set(shape.src, await loadImage(shape.src));
    } catch {
      // Broken media renders as an empty box, matching the canvas editor.
    }
  }

  const stage = new Konva.Stage({ container: getHost(), width: project.width, height: project.height });
  const layer = new Konva.Layer();
  layer.add(
    new Konva.Rect({ x: 0, y: 0, width: project.width, height: project.height, fill: page.background }),
  );
  for (const shape of page.shapes) {
    if (shape.hidden) continue;
    const image = shape.kind === "image" ? (imageNodes.get(shape.src) ?? null) : null;
    layer.add(buildNode(shape, image));
  }
  stage.add(layer);
  const dataUrl = stage.toDataURL({ pixelRatio, mimeType: "image/png" });
  stage.destroy();
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}
