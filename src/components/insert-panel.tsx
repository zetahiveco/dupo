import {
  PiAlignBottom,
  PiAlignCenterHorizontal,
  PiAlignCenterVertical,
  PiAlignLeft,
  PiAlignRight,
  PiAlignTop,
  PiTextAlignCenter,
  PiTextAlignLeft,
  PiTextAlignRight,
  PiTextB,
  PiTextItalic,
} from "react-icons/pi";
import type { CanvasShape } from "../doc-model";

function safeHex(value: string | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
}

const FONTS = [
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Mono", value: "ui-monospace, Menlo, monospace" },
];

export type AlignEdge = "left" | "centerH" | "right" | "top" | "middle" | "bottom";

export function InsertPanel({
  background,
  onBackground,
  onExport,
  exporting,
  selected,
  onPatch,
  onAlign,
}: {
  background: string;
  onBackground: (color: string) => void;
  onExport: (format: "pdf" | "pptx" | "png") => void;
  exporting: string | null;
  selected: CanvasShape | null;
  onPatch: (patch: Partial<CanvasShape>) => void;
  onAlign: (edge: AlignEdge) => void;
}) {
  const isText = selected !== null && selected.kind === "text";
  const fontStyle = (isText && selected.fontStyle) || "";
  const bold = fontStyle.includes("bold");
  const italic = fontStyle.includes("italic");
  const pathFill = selected !== null && selected.kind === "path" ? selected.fill : undefined;

  function toggleStyle(flag: "bold" | "italic") {
    if (!isText || !selected) return;
    const nextBold = flag === "bold" ? !bold : bold;
    const nextItalic = flag === "italic" ? !italic : italic;
    const style = [nextBold ? "bold" : "", nextItalic ? "italic" : ""].filter(Boolean).join(" ");
    const fontStyleValue = style === "" ? "normal" : style;
    onPatch({ fontStyle: fontStyleValue === "bold" ? "bold" : fontStyleValue === "italic" ? "italic" : "normal" });
  }

  return (
    <div className="insert-panel">
      {selected ? (
        <>
          <div className="panel-title">Shape</div>
          {isText ? (
            <>
              <label className="color-row">
                <span>Fill</span>
                <input type="color" value={safeHex(selected.fill)} onChange={(event) => onPatch({ fill: event.target.value })} />
              </label>
              <select
                className="field"
                aria-label="Font"
                value={selected.fontFamily || FONTS[0].value}
                onChange={(event) => onPatch({ fontFamily: event.target.value })}
              >
                {FONTS.map((font) => (
                  <option key={font.value} value={font.value}>{font.label}</option>
                ))}
              </select>
              <label className="color-row">
                <span>Size</span>
                <input
                  type="number"
                  min={8}
                  max={400}
                  value={"fontSize" in selected ? Math.round(selected.fontSize) : 24}
                  onChange={(event) => onPatch({ fontSize: Number(event.target.value) || 24 })}
                />
              </label>
              <div className="chip-row">
                <button className={"chip-btn" + (bold ? " active" : "")} title="Bold" onClick={() => toggleStyle("bold")}>
                  <PiTextB size={14} />
                </button>
                <button className={"chip-btn" + (italic ? " active" : "")} title="Italic" onClick={() => toggleStyle("italic")}>
                  <PiTextItalic size={14} />
                </button>
                <button className={"chip-btn" + ((selected.align ?? "left") === "left" ? " active" : "")} title="Align left" onClick={() => onPatch({ align: "left" })}>
                  <PiTextAlignLeft size={14} />
                </button>
                <button className={"chip-btn" + (selected.align === "center" ? " active" : "")} title="Align center" onClick={() => onPatch({ align: "center" })}>
                  <PiTextAlignCenter size={14} />
                </button>
                <button className={"chip-btn" + (selected.align === "right" ? " active" : "")} title="Align right" onClick={() => onPatch({ align: "right" })}>
                  <PiTextAlignRight size={14} />
                </button>
              </div>
            </>
          ) : selected.kind === "rect" || selected.kind === "circle" ? (
            <>
              <label className="color-row">
                <span>Fill</span>
                <input type="color" value={safeHex(selected.fill)} onChange={(event) => onPatch({ fill: event.target.value })} />
              </label>
              <label className="color-row">
                <span>Border</span>
                <input type="color" value={safeHex(selected.stroke ?? "#1f2430")} onChange={(event) => onPatch({ stroke: event.target.value, strokeWidth: selected.strokeWidth ?? 2 })} />
              </label>
              <label className="color-row">
                <span>Border width</span>
                <input
                  type="number"
                  min={0}
                  max={80}
                  value={Math.round(selected.strokeWidth ?? 0)}
                  onChange={(event) => {
                    const width = Math.max(0, Number(event.target.value) || 0);
                    onPatch({ strokeWidth: width > 0 ? width : undefined, stroke: width > 0 ? (selected.stroke ?? "#1f2430") : undefined });
                  }}
                />
              </label>
            </>
          ) : selected.kind === "path" ? (
            <>
              <label className="color-row">
                <span>Border</span>
                <input type="color" value={safeHex(selected.stroke)} onChange={(event) => onPatch({ stroke: event.target.value })} />
              </label>
              <label className="color-row">
                <span>Border width</span>
                <input
                  type="number"
                  min={1}
                  max={80}
                  value={Math.round(selected.strokeWidth)}
                  onChange={(event) => onPatch({ strokeWidth: Math.max(1, Number(event.target.value) || 4) })}
                />
              </label>
              <label className="color-row">
                <span>Fill shape</span>
                <input
                  type="checkbox"
                  checked={pathFill !== undefined}
                  onChange={(event) => onPatch({ fill: event.target.checked ? safeHex(pathFill ?? "#3a86ff") : undefined })}
                />
              </label>
              {pathFill !== undefined ? (
                <label className="color-row">
                  <span>Fill</span>
                  <input type="color" value={safeHex(pathFill)} onChange={(event) => onPatch({ fill: event.target.value })} />
                </label>
              ) : null}
            </>
          ) : null}
          <label className="color-row">
            <span>Opacity</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((selected.opacity ?? 1) * 100)}
              onChange={(event) => onPatch({ opacity: Number(event.target.value) / 100 })}
            />
          </label>
          <div className="panel-title">Align</div>
          <div className="chip-row">
            <button className="chip-btn" title="Align left on page" onClick={() => onAlign("left")}>
              <PiAlignLeft size={14} />
            </button>
            <button className="chip-btn" title="Center horizontally" onClick={() => onAlign("centerH")}>
              <PiAlignCenterHorizontal size={14} />
            </button>
            <button className="chip-btn" title="Align right on page" onClick={() => onAlign("right")}>
              <PiAlignRight size={14} />
            </button>
            <button className="chip-btn" title="Align top" onClick={() => onAlign("top")}>
              <PiAlignTop size={14} />
            </button>
            <button className="chip-btn" title="Center vertically" onClick={() => onAlign("middle")}>
              <PiAlignCenterVertical size={14} />
            </button>
            <button className="chip-btn" title="Align bottom" onClick={() => onAlign("bottom")}>
              <PiAlignBottom size={14} />
            </button>
          </div>
        </>
      ) : null}
      <div className="panel-title">Page</div>
      <label className="color-row">
        <span>Background</span>
        <input type="color" value={background} onChange={(event) => onBackground(event.target.value)} />
      </label>
      <div className="panel-title">Export</div>
      <div className="export-buttons">
        <button className="text-btn" onClick={() => onExport("pdf")} disabled={exporting !== null}>
          <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor"><path d="M222,152v56a16,16,0,0,1-16,16H50a16,16,0,0,1-16-16V152a8,8,0,0,1,16,0v56H206V152a8,8,0,0,1,16,0ZM117.66,125.66,88,156H168l-29.66-30.34a8,8,0,0,1,11.32-11.32l40,40a8,8,0,0,1,0,11.32l-40,40a8,8,0,0,1-11.32-11.32" transform="rotate(180 128 128)" /><path d="M128,24l-72,72,11.2,11.2L120,54.4V168a8,8,0,0,0,16,0V54.4l52.8,52.8L200,96Z" /></svg>
          PDF
        </button>
        <button className="text-btn" onClick={() => onExport("pptx")} disabled={exporting !== null}>
          <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor"><path d="M245.66,122.34l-48-48a8,8,0,0,0-11.32,11.32L220.69,120H136V48a8,8,0,0,0-16,0v72H35.31l34.35-34.34a8,8,0,0,0-11.32-11.32l-48,48a8,8,0,0,0,0,11.32l48,48a8,8,0,0,0,11.32-11.32L35.31,136H120v72a8,8,0,0,0,16,0V136h84.69l-34.35,34.34a8,8,0,0,0,11.32,11.32l48-48A8,8,0,0,0,245.66,122.34Z" /></svg>
          PPT
        </button>
        <button className="text-btn" onClick={() => onExport("png")} disabled={exporting !== null}>
          <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor"><path d="M208,56H180.28L166.65,35.64A8,8,0,0,0,160,32H96a8,8,0,0,0-6.65,3.64L75.71,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56Zm8,136a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V80a8,8,0,0,1,8-8H80a8,8,0,0,0,6.66-3.56L100.28,48h55.43l13.62,20.44A8,8,0,0,0,176,72h32a8,8,0,0,1,8,8ZM128,88a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,88Zm0,72a28,28,0,1,1,28-28A28,28,0,0,0,128,160Z" /></svg>
          PNG
        </button>
      </div>
      {exporting ? <div className="export-note">{exporting}…</div> : null}
    </div>
  );
}
