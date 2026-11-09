/** Page model for paged projects (documents and presentations). */

export type CanvasText = {
  id: string;
  kind: "text";
  x: number;
  y: number;
  width: number;
  text: string;
  fontSize: number;
  fill: string;
  fontStyle?: "bold" | "italic" | "normal";
  fontFamily?: string;
  align?: "left" | "center" | "right";
};

export type CanvasRect = {
  id: string;
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  cornerRadius?: number;
  stroke?: string;
  strokeWidth?: number;
};

export type CanvasCircle = {
  id: string;
  kind: "circle";
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
};

export type CanvasPath = {
  id: string;
  kind: "path";
  x: number;
  y: number;
  width: number;
  height: number;
  data: string;
  stroke: string;
  strokeWidth: number;
  fill?: string;
};

export type CanvasImage = {
  id: string;
  kind: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
};

export type CanvasShape = (CanvasText | CanvasRect | CanvasCircle | CanvasPath | CanvasImage) & {
  rotation?: number;
  opacity?: number;
  locked?: boolean;
  hidden?: boolean;
  name?: string;
  scaleX?: number;
  scaleY?: number;
};

export type Page = {
  id: string;
  background: string;
  shapes: CanvasShape[];
};

export type DocProject = {
  version: 1;
  kind: "documents" | "presentations";
  name: string;
  preset: string;
  width: number;
  height: number;
  pages: Page[];
};

export function nextId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function blankPage(): Page {
  return { id: nextId(), background: "#ffffff", shapes: [] };
}

export function blankDoc(
  kind: "documents" | "presentations",
  name: string,
  preset: string,
  width: number,
  height: number,
): DocProject {
  return { version: 1, kind, name, preset, width, height, pages: [blankPage()] };
}

export function parseDoc(raw: string): DocProject | null {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    if (value.version !== 1) return null;
    if (value.kind !== "documents" && value.kind !== "presentations") return null;
    if (typeof value.name !== "string" || !Array.isArray(value.pages)) return null;
    const width = Math.round(Number(value.width));
    const height = Math.round(Number(value.height));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16) return null;
    const pages: Page[] = [];
    for (const rawPage of value.pages) {
      if (!rawPage || typeof rawPage !== "object") continue;
      const row = rawPage as Record<string, unknown>;
      const shapes: CanvasShape[] = [];
      if (Array.isArray(row.shapes)) {
        for (const item of row.shapes) {
          const shape = parseShape(item);
          if (!shape) continue;
          const extra = item as Record<string, unknown>;
          shapes.push({
            ...shape,
            rotation: Number.isFinite(Number(extra.rotation)) ? Number(extra.rotation) : undefined,
            opacity: Number.isFinite(Number(extra.opacity)) ? Math.min(1, Math.max(0, Number(extra.opacity))) : undefined,
            locked: extra.locked === true ? true : undefined,
            hidden: extra.hidden === true ? true : undefined,
            name: typeof extra.name === "string" && extra.name.trim() ? extra.name.trim().slice(0, 60) : undefined,
          });
        }
      }
      pages.push({
        id: typeof row.id === "string" && row.id ? row.id : nextId(),
        background: safeColor(row.background, "#ffffff"),
        shapes,
      });
    }
    return {
      version: 1,
      kind: value.kind,
      name: value.name.slice(0, 120),
      preset: typeof value.preset === "string" ? value.preset : "custom",
      width,
      height,
      pages: pages.length ? pages : [blankPage()],
    };
  } catch {
    return null;
  }
}

function parseShape(value: unknown): CanvasShape | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" && row.id ? row.id : "";
  if (!id) return null;
  const x = Number(row.x) || 0;
  const y = Number(row.y) || 0;
  const width = Math.max(8, Number(row.width) || 120);
  const fill = safeColor(row.fill, row.kind === "text" ? "#1f2430" : "#3a86ff");
  if (row.kind === "text") {
    const align = row.align;
    return {
      id,
      kind: "text",
      x,
      y,
      width,
      text: typeof row.text === "string" ? row.text : "",
      fontSize: Math.max(8, Number(row.fontSize) || 48),
      fill,
      fontStyle: row.fontStyle === "bold" || row.fontStyle === "italic" ? row.fontStyle : undefined,
      fontFamily: typeof row.fontFamily === "string" && row.fontFamily.length < 80 ? row.fontFamily : undefined,
      align: align === "center" || align === "right" ? align : "left",
    };
  }
  if (row.kind === "rect") {
    return {
      id,
      kind: "rect",
      x,
      y,
      width,
      height: Math.max(8, Number(row.height) || 80),
      fill,
      cornerRadius: Math.max(0, Number(row.cornerRadius) || 0),
      stroke: safeColor(row.stroke, "") || undefined,
      strokeWidth: Number(row.strokeWidth) > 0 ? Number(row.strokeWidth) : undefined,
    };
  }
  if (row.kind === "circle") {
    return {
      id,
      kind: "circle",
      x,
      y,
      width,
      height: Math.max(8, Number(row.height) || width),
      fill,
      stroke: safeColor(row.stroke, "") || undefined,
      strokeWidth: Number(row.strokeWidth) > 0 ? Number(row.strokeWidth) : undefined,
    };
  }
  if (row.kind === "path") {
    const data = typeof row.data === "string" ? row.data.slice(0, 40000) : "";
    if (!data) return null;
    return {
      id,
      kind: "path",
      x,
      y,
      width,
      height: Math.max(8, Number(row.height) || 80),
      data,
      stroke: safeColor(row.stroke, "#1f2430"),
      strokeWidth: Math.max(1, Number(row.strokeWidth) || 4),
      fill: safeColor(row.fill, "") || undefined,
      scaleX: Math.max(0.05, Number(row.scaleX) || 1),
      scaleY: Math.max(0.05, Number(row.scaleY) || 1),
    };
  }
  if (row.kind === "image") {
    let src = typeof row.src === "string" && (row.src.startsWith("data:") || row.src.startsWith("asset://") || row.src.startsWith("http") || row.src.startsWith("media://")) ? row.src : "";
    if (src.startsWith("media://") && !src.startsWith("media://localhost/")) {
      src = src.replace("media://", "media://localhost/");
    }
    if (!src) return null;
    return {
      id,
      kind: "image",
      x,
      y,
      width,
      height: Math.max(8, Number(row.height) || 80),
      src,
    };
  }
  return null;
}

export function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}
