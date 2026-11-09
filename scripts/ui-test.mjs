/* eslint-disable */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://127.0.0.1:1420/";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--window-size=1400,1000"],
  defaultViewport: { width: 1380, height: 980 },
});

const page = await browser.newPage();
page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 300)));
page.on("console", (msg) => {
  if (msg.type() === "error" && !msg.text().includes("Failed to load resource")) console.log("[console.error]", msg.text().slice(0, 300));
});

await page.evaluateOnNewDocument(() => {
  const settings = { projectsFolder: "/tmp/dupo-test", theme: "dark", mcpEnabled: false };
  const mcp = { running: false, port: 0, url: "", claude: "", codex: "", opencode: "" };
  let projectPath = "/tmp/dupo-test/test.dupo";
  let content = "";
  window.__mockState = {
    get content() { return content; },
    get path() { return projectPath; },
  };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      switch (cmd) {
        case "get_snapshot":
          return { settings, projects: [], mcp };
        case "reload_projects":
          return [];
        case "save_settings":
          return { settings: args.settings, projects: [], mcp };
        case "create_project": {
          const np = args.newProject;
          projectPath = `/tmp/dupo-test/${np.name}.dupo`;
          content = np.kind === "videos"
            ? JSON.stringify({ version: 2, kind: np.kind, name: np.name, preset: np.preset, width: np.width, height: np.height, tracks: [{ id: "t1", kind: "video", name: "Video 1", clips: [] }], texts: [] })
            : JSON.stringify({ version: 1, kind: np.kind, name: np.name, preset: np.preset, width: np.width, height: np.height, pages: [{ id: "p1", background: "#ffffff", shapes: [] }] });
          return { id: projectPath, kind: np.kind, name: np.name, path: projectPath, width: np.width, height: np.height, updatedAt: Date.now() };
        }
        case "read_project":
          return content;
        case "write_project":
          content = args.content;
          return null;
        case "export_project": {
          try {
            const req = args.request;
            // Dump the first page's PNG for Rust-side decode verification.
            if (req.pages[0]) {
              window.__pageDump = req.pages[0];
            }
            const decoded = req.pages.map((b64) => {
              const bin = atob(b64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const magic = String.fromCharCode(...bytes.slice(0, 8));
              const isPng = magic === "\u0089PNG\r\n\u001a\n";
              const view = new DataView(bytes.buffer);
              const width = isPng ? view.getUint32(16) : 0;
              const height = isPng ? view.getUint32(20) : 0;
              return { isPng, width, height };
            });
            window.__exportCheck = {
              format: req.format,
              name: req.name,
              pageCount: req.pages.length,
              allPng: decoded.every((d) => d.isPng),
              dims: decoded.map((d) => `${d.width}x${d.height}`),
            };
            return { savedTo: `/tmp/dupo-test/${req.name}.${req.format}` };
          } catch (error) {
            window.__exportCheck = { error: String(error) };
            throw error;
          }
        }
        case "pick_file":
          return { path: null, canceled: true };
        case "pick_folder":
          return { path: null, canceled: true };
        case "export_project":
          return null;
        case "mcp_status":
        case "mcp_start":
        case "mcp_stop":
          return mcp;
        case "log_message":
          return null;
        default:
          console.error("MOCK: unhandled command " + cmd);
          return null;
      }
    },
  };
});

await page.goto(URL, { waitUntil: "networkidle2" });

// Create a documents project
await page.waitForSelector("#project-name");
await page.type("#project-name", "test");
await page.click(".primary-btn");
await page.waitForSelector(".stage-wrap canvas", { timeout: 10000 });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Always re-query the canvas rect — the layout shifts as panels change.
async function canvasBox() {
  const canvas = await page.$(".stage-wrap canvas");
  const box = await canvas.boundingBox();
  return { left: box.x, top: box.y, width: box.width, height: box.height };
}
const ZOOM = 0.65; // stage zoom stays fixed after mount (scale computed once)
async function pagePoint(px, py) {
  const box = await canvasBox();
  return { x: box.left + px * ZOOM, y: box.top + py * ZOOM };
}

async function savedProject() {
  await sleep(900); // wait past save debounce
  return JSON.parse(await page.evaluate(() => window.__mockState.content));
}

async function drag(from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(16);
  }
  await page.mouse.up();
  await sleep(50);
}

// Toolbar button helper — insert cards moved to the top toolbar.
async function toolbarButton(titleStart) {
  return page.waitForSelector(`.canvas-toolbar .icon-btn[title^="${titleStart}"]`, { timeout: 5000 });
}

// ---- Test 1: text drag ----
console.log("\n== TEST 1: text drag ==");
const textBtn = await toolbarButton("Add text");
await textBtn.click();
await sleep(200);

const before = await savedProject();
const text = before.pages[0].shapes.find((s) => s.kind === "text");
console.log("text shape:", JSON.stringify({ x: text.x, y: text.y, width: text.width, fontSize: text.fontSize }));

const tc = await pagePoint(text.x + text.width / 2, text.y + text.fontSize / 2);
await drag(tc, { x: tc.x - 150, y: tc.y - 100 });
const afterDrag = await savedProject();
const text2 = afterDrag.pages[0].shapes.find((s) => s.kind === "text");
console.log("after drag:", JSON.stringify({ x: text2.x, y: text2.y }));
console.log(text2.x !== text.x || text2.y !== text.y ? "TEXT DRAG: PASS" : "TEXT DRAG: FAIL");

// ---- Test 2: double-click inline edit ----
console.log("\n== TEST 2: inline text edit ==");
const tc2 = await pagePoint(text2.x + text2.width / 2, text2.y + text2.fontSize / 2);
for (let i = 0; i < 2; i++) {
  await page.mouse.move(tc2.x, tc2.y);
  await page.mouse.down();
  await page.mouse.up();
}
await sleep(300);
const editor = await page.$("textarea.text-edit");
console.log(editor ? "textarea opened: PASS" : "textarea opened: FAIL");
if (editor) {
  await page.keyboard.down("Meta");
  await page.keyboard.press("a");
  await page.keyboard.up("Meta");
  await page.keyboard.type("EDITED");
  await page.mouse.click((await canvasBox()).left + 30, (await canvasBox()).top + 30); // blur commits
  await sleep(300);
  const afterEdit = await savedProject();
  const t3 = afterEdit.pages[0].shapes.find((s) => s.kind === "text");
  console.log("text after edit:", JSON.stringify(t3.text));
  console.log(t3.text === "EDITED" ? "EDIT: PASS" : "EDIT: FAIL");
}

// ---- Test 3: pen tool no longer freehand ----
console.log("\n== TEST 3: pen tool select ==");
const toolTitles = await page.$$eval(".canvas-toolbar .icon-btn", (els) => els.map((e) => e.title));
console.log("toolbar:", JSON.stringify(toolTitles.filter((t) => /Path|Rectangle|Circle|image/i.test(t))));
const pathBtn = await toolbarButton("Path");
await pathBtn.click();
await sleep(150);
// a plain drag must NOT create a path anymore (pen adds points only on click)
const from = await pagePoint(200, 200);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
for (let i = 1; i <= 20; i++) {
  await page.mouse.move(from.x + i * 10, from.y + Math.sin(i / 2) * 40);
  await sleep(16);
}
await page.mouse.up();
await sleep(100);
// Escape discards the single stray point and exits the tool
await page.keyboard.press("Escape");
await sleep(200);
const afterPath = await savedProject();
const pathShape = afterPath.pages[0].shapes.find((s) => s.kind === "path");
console.log(!pathShape ? "NO FREEHAND DRAG: PASS" : "NO FREEHAND DRAG: FAIL");

// ---- Test 5: rect drag ----
console.log("\n== TEST 5: rect drag ==");
const rectBtn = await toolbarButton("Rectangle");
await rectBtn.click();
await sleep(150);
await drag(await pagePoint(500, 500), await pagePoint(700, 620)); // draw rect
await sleep(100);
const afterRect = await savedProject();
const rect = afterRect.pages[0].shapes.find((s) => s.kind === "rect");
console.log("rect drawn:", JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
const rc = await pagePoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
await drag(rc, { x: rc.x + 100, y: rc.y + 60 });
const afterRectDrag = await savedProject();
const r2 = afterRectDrag.pages[0].shapes.find((s) => s.kind === "rect");
console.log("rect after drag:", JSON.stringify({ x: r2.x, y: r2.y }));
console.log(r2.x !== rect.x ? "RECT DRAG: PASS" : "RECT DRAG: FAIL");

// ---- Test 6: Figma-style pen (polygon) with Shift 45° snapping ----
console.log("\n== TEST 6: pen polygon tool ==");
const penBtn = await toolbarButton("Path");
await penBtn.click();
await sleep(150);
// point 1
let p = await pagePoint(300, 600);
await page.mouse.click(p.x, p.y);
await sleep(80);
// point 2 (horizontal)
p = await pagePoint(400, 600);
await page.mouse.click(p.x, p.y);
await sleep(80);
// point 3 with Shift: cursor at ~37° should snap to 45° → relative (135.4, 35.4)
const cursor = await pagePoint(440, 630);
await page.keyboard.down("Shift");
await page.mouse.move(cursor.x, cursor.y);
await page.mouse.click(cursor.x, cursor.y);
await page.keyboard.up("Shift");
await sleep(80);
await page.keyboard.press("Enter"); // finish polygon
await sleep(200);
const afterPen = await savedProject();
const pen = afterPen.pages[0].shapes.find((s) => s.kind === "path");
const penCoords = pen ? pen.data.split(/(?=[ML])/).map((seg) => seg.trim()) : [];
console.log("pen path:", pen ? JSON.stringify({ x: pen.x, y: pen.y, data: pen.data }) : "MISSING");
const p3 = penCoords[2] ? penCoords[2].split(" ").slice(1).map(Number) : null;
const snappedOk = p3 && Math.abs(p3[0] - 135.4) < 3 && Math.abs(p3[1] - 35.4) < 3;
console.log(p3 ? `pen point 3 (relative): ${p3} → ${snappedOk ? "SHIFT SNAP: PASS" : "SHIFT SNAP: FAIL"}` : "pen point 3 missing");
console.log(pen && penCoords.length === 3 && !pen.data.includes("Z") ? "PEN POLYGON: PASS" : "PEN POLYGON: FAIL");

// drag the finished polygon from its first point
if (pen) {
  const pc = await pagePoint(pen.x, pen.y);
  await drag(pc, { x: pc.x + 60, y: pc.y + 30 });
  const afterPenDrag = await savedProject();
  const p2 = afterPenDrag.pages[0].shapes.find((s) => s.kind === "path");
  console.log(p2.x !== pen.x ? "PEN PATH DRAG: PASS" : "PEN PATH DRAG: FAIL");
}

// ---- Test 7: layers panel ----
console.log("\n== TEST 7: layers panel ==");
const layerRows = await page.$$eval(".layer-row .layer-name", (els) => els.map((e) => e.textContent));
console.log("layer rows (top first):", JSON.stringify(layerRows));
const shapesInFile = afterPen.pages[0].shapes;
const expectedOrder = shapesInFile
  .slice()
  .reverse()
  .map((s) => (s.kind === "text" ? s.text.slice(0, 28) || "Text" : s.kind === "rect" ? "Rectangle" : s.kind === "circle" ? "Circle" : s.kind === "path" ? "Path" : "Image"));
console.log(layerRows.length === shapesInFile.length && JSON.stringify(layerRows) === JSON.stringify(expectedOrder) ? "LAYER ORDER: PASS" : "LAYER ORDER: FAIL");

// hide the text layer via eye button (last row)
const rowsAll = await page.$$(".layer-row");
const lastRow = rowsAll[rowsAll.length - 1];
const lastRowEye = await lastRow.$(".layer-btn");
await lastRowEye.click();
await sleep(900);
const afterHide = JSON.parse(await page.evaluate(() => window.__mockState.content));
const textShape = afterHide.pages[0].shapes.find((s) => s.kind === "text");
console.log(textShape.hidden === true ? "LAYER HIDE: PASS" : "LAYER HIDE: FAIL");

// reorder: send the top layer backward
const beforeReorder = JSON.parse(await page.evaluate(() => window.__mockState.content)).pages[0].shapes;
const rowsForReorder = await page.$$(".layer-row");
const downBtn = await rowsForReorder[0].$('.layer-actions .layer-btn[title="Send backward"]');
if (downBtn) {
  await downBtn.click();
  await sleep(900);
  const afterReorder = JSON.parse(await page.evaluate(() => window.__mockState.content)).pages[0].shapes;
  console.log(afterReorder[afterReorder.length - 1].id !== beforeReorder[beforeReorder.length - 1].id ? "LAYER REORDER: PASS" : "LAYER REORDER: FAIL");
} else {
  console.log("LAYER REORDER: FAIL (button missing)");
}

// ---- Test 8: shape border + fill editing ----
console.log("\n== TEST 8: border and fill editing ==");
async function layerRowByLabel(label) {
  const handle = await page.evaluateHandle((wanted) => {
    const rows = Array.from(document.querySelectorAll(".layer-row"));
    return rows.find((row) => row.querySelector(".layer-name")?.textContent === wanted) ?? null;
  }, label);
  const el = handle.asElement();
  if (!el) throw new Error("layer row not found: " + label);
  return el;
}

// select the rect by clicking its center
const rCenter = await pagePoint(r2.x + r2.width / 2, r2.y + r2.height / 2);
await page.mouse.click(rCenter.x, rCenter.y);
await sleep(250);
// set border width via the panel number input
const borderWidthInput = await page.$('.insert-panel .color-row input[type="number"][min="0"]');
console.log(borderWidthInput ? "border input found: PASS" : "border input found: FAIL");
if (borderWidthInput) {
  // React-controlled number input: set value with the native setter then dispatch input
  await page.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, "6");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, borderWidthInput);
  await sleep(900);
  const afterBorder = JSON.parse(await page.evaluate(() => window.__mockState.content));
  const r3 = afterBorder.pages[0].shapes.find((s) => s.kind === "rect");
  console.log("rect border:", JSON.stringify({ stroke: r3.stroke, strokeWidth: r3.strokeWidth }));
  console.log(r3.strokeWidth === 6 && r3.stroke ? "BORDER EDIT: PASS" : "BORDER EDIT: FAIL");
}

// path border width: select the pen path via its layers row, set width to 9
const pathRow = await layerRowByLabel("Path");
await pathRow.click();
await sleep(250);
const pathBorderInput = await page.$('.insert-panel .color-row input[type="number"][min="1"]');
if (pathBorderInput) {
  await page.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, "9");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, pathBorderInput);
  await sleep(900);
  const afterPathBorder = JSON.parse(await page.evaluate(() => window.__mockState.content));
  const p4 = afterPathBorder.pages[0].shapes.find((s) => s.kind === "path");
  console.log(p4.strokeWidth === 9 ? "PATH BORDER EDIT: PASS" : `PATH BORDER EDIT: FAIL (strokeWidth=${p4.strokeWidth})`);
} else {
  console.log("PATH BORDER EDIT: FAIL (input missing)");
}

// ---- Test 9: layer rename ----
console.log("\n== TEST 9: layer rename ==");
const rectRow = await layerRowByLabel("Rectangle");
// native double-click synthesized by the browser (real user double-click)
await page.evaluate((row) => {
  const nameEl = row.querySelector(".layer-name");
  nameEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  nameEl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  nameEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  nameEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  nameEl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  nameEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  nameEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
}, rectRow);
await sleep(200);
const renameInput = await page.$(".layer-rename");
console.log(renameInput ? "rename input: PASS" : "rename input: FAIL");
if (renameInput) {
  await page.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, renameInput);
  await renameInput.type("My Shape");
  await page.keyboard.press("Enter");
  await sleep(900);
  const afterRename = JSON.parse(await page.evaluate(() => window.__mockState.content));
  const rectNamed = afterRename.pages[0].shapes.find((s) => s.name === "My Shape");
  console.log(rectNamed ? "LAYER RENAME: PASS" : "LAYER RENAME: FAIL");
  const rowLabels = await page.$$eval(".layer-row .layer-name", (els) => els.map((e) => e.textContent));
  console.log("rows after rename:", JSON.stringify(rowLabels));
}

// ---- Test 10: export to PDF / PPT / PNG ----
console.log("\n== TEST 10: export ==");
async function runExport(label) {
  const btn = await page.waitForSelector(`.insert-panel .text-btn[title="Export as ${label}"]`, { timeout: 5000 }).catch(() => null);
  const exportButtons = await page.$$(".export-buttons .text-btn");
  const index = { PDF: 0, PPT: 1, PNG: 2 }[label];
  await exportButtons[index].click();
  await sleep(2500);
  const check = await page.evaluate(() => window.__exportCheck);
  console.log(`${label} export:`, JSON.stringify(check));
  const ok = check && check.allPng && check.pageCount >= 1 && !check.error;
  console.log(ok ? `EXPORT ${label}: PASS` : `EXPORT ${label}: FAIL`);
}

await runExport("PDF");
if (await page.evaluate(() => !!window.__pageDump)) {
  const b64 = await page.evaluate(() => window.__pageDump);
  fs.writeFileSync("/tmp/dupo-export/page1.png", Buffer.from(b64, "base64"));
  console.log("page dump written");
}
await runExport("PPT");
await runExport("PNG");

await page.screenshot({ path: "/tmp/dupo-final.png" });
await browser.close();
console.log("\nDONE");
