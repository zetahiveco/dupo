//! MCP-over-HTTP server (Model Context Protocol, streamable HTTP transport).
//! Exposes dupo projects to local AI agents on 127.0.0.1:47330.

use crate::commands::SharedApp;
use crate::settings::DEFAULT_PORT;
use crate::store::{self, ProjectMeta};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

pub const ACCEPTED_PROTOCOLS: [&str; 4] = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const PROTOCOL: &str = "2025-03-26";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub port: u16,
    pub url: String,
    pub claude: String,
    pub codex: String,
    pub opencode: String,
}

pub struct Running {
    pub stop: Arc<AtomicBool>,
    pub handle: Option<JoinHandle<()>>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// Clonable handle to app state, safe to move into server threads.
#[derive(Clone)]
pub struct Deps {
    pub shared: SharedApp,
}

pub fn status(shared: &SharedApp) -> Status {
    let port = DEFAULT_PORT;
    let running = shared.mcp_running();
    let url = format!("http://127.0.0.1:{port}/mcp");
    Status {
        running,
        port,
        url: url.clone(),
        claude: format!("claude mcp add --transport http dupo {url}"),
        codex: format!("codex mcp add --url {url} dupo"),
        opencode: format!("opencode mcp add dupo {url}"),
    }
}

pub fn start(shared: SharedApp) -> Result<Status, String> {
    if shared.mcp_running() {
        return Ok(status(&shared));
    }
    let server = serve(Deps { shared: shared.clone() })?;
    shared.set_mcp(server);
    Ok(status(&shared))
}

pub fn stop(shared: &SharedApp) {
    shared.clear_mcp(); // Dropping Running signals the accept loop to exit.
}

fn folder(shared: &SharedApp) -> Result<PathBuf, String> {
    let settings = shared.settings();
    let folder = PathBuf::from(settings.projects_folder.clone());
    drop(settings);
    store::ensure_folder(&folder)?;
    Ok(folder)
}

fn arg(arguments: Option<&Value>, key: &str) -> Result<String, String> {
    arguments
        .and_then(|a| a.get(key))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Missing required argument: {key}"))
}

fn optional_str(arguments: Option<&Value>, key: &str) -> Option<String> {
    arguments
        .and_then(|a| a.get(key))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn text_result(payload: Value) -> Value {
    json!({
        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&payload).unwrap_or_default() }]
    })
}

fn text_raw(message: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": message }] })
}

fn error_result(message: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

fn tools() -> Value {
    json!([
        {
            "name": "list_projects",
            "description": "List Dupo projects (documents, presentations, videos) with kind, dimensions, and file paths.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "read_project",
            "description": "Read the full JSON content of a Dupo project file (.dupo). Pass the path returned by list_projects. Document pages contain shapes (text/rect/circle/path/image with x/y/width/height); video projects contain tracks (video/audio) with clips and texts.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Absolute path to a .dupo file" } },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "update_project",
            "description": "Replace the full JSON content of a Dupo project file. Read the project first, modify it, then write it back.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string", "description": "The complete new JSON document" }
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }
        },
        {
            "name": "update_page",
            "description": "Update a single page of a Dupo document/presentation: replace its shapes array and/or background color without rewriting the whole file. Pass the full new shapes array for the page.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path to a .dupo file" },
                    "page": { "type": "number", "description": "Zero-based page index (default 0)" },
                    "background": { "type": "string", "description": "Optional new page background hex color" },
                    "shapes": { "type": "array", "description": "Optional full replacement shapes array for the page" }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "get_page_shot",
            "description": "Render a page of a Dupo document/presentation to a PNG image and return it, so the agent can see the result. Save the project in Dupo (or write it with update_project/update_page) before calling.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path to the .dupo project" },
                    "page": { "type": "number", "description": "Zero-based page index (default 0)" }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "create_document",
            "description": "Create a new Dupo document project. Width/height in pixels (e.g. 1080x1080 LinkedIn post, 794x1123 A4, 816x1056 US Letter).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "width": { "type": "number" },
                    "height": { "type": "number" }
                },
                "required": ["name"],
                "additionalProperties": false
            }
        },
        {
            "name": "create_video",
            "description": "Create a new Dupo video project. Width/height in pixels (default 1920x1080; use 1080x1920 for vertical).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "width": { "type": "number" },
                    "height": { "type": "number" }
                },
                "required": ["name"],
                "additionalProperties": false
            }
        },
        {
            "name": "update_document",
            "description": "Replace the full JSON content of a Dupo document or presentation project. Read the project first, modify it, then write it back.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string", "description": "The complete new JSON document" }
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }
        },
        {
            "name": "update_video",
            "description": "Replace the full JSON content of a Dupo video project (tracks with video/audio clips, and text overlays). Read the project first, modify it, then write it back.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string", "description": "The complete new JSON document" }
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }
        },
        {
            "name": "delete_document",
            "description": "Delete a Dupo document or presentation project file permanently.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "delete_video",
            "description": "Delete a Dupo video project file permanently.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "export_project",
            "description": "Export a Dupo document or presentation to PDF, PowerPoint (PPTX), or PNG images and reveal the file. Renders the saved pages headlessly; save the project in Dupo first.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to the .dupo project" },
                    "format": { "type": "string", "enum": ["pdf", "pptx", "png"] },
                    "output": { "type": "string", "description": "Optional absolute output file path" }
                },
                "required": ["path", "format"],
                "additionalProperties": false
            }
        }
    ])
}

pub fn parse_color(hex: &str) -> [u8; 3] {
    let hex = hex.trim().trim_start_matches('#');
    if hex.len() >= 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&hex[0..2], 16),
            u8::from_str_radix(&hex[2..4], 16),
            u8::from_str_radix(&hex[4..6], 16),
        ) {
            return [r, g, b];
        }
    }
    [40, 40, 40]
}

fn load_media(folder: &Path, src: &str) -> Option<Vec<u8>> {
    let name = src.strip_prefix("media://")?;
    let name = name.strip_prefix("localhost/").unwrap_or(name);
    let name = percent_decode(name);
    let path = folder.join("media").join(name);
    fs::read(path).ok()
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Headless page rasterizer for MCP exports. Shapes paint onto an RGB canvas;
/// text uses a built-in bitmap font (upper-case, digits, common punctuation).
fn render_pages(project: &Value, media: &Path) -> Result<Vec<Vec<u8>>, String> {
    let width = project.get("width").and_then(|v| v.as_u64()).unwrap_or(1080) as u32;
    let height = project.get("height").and_then(|v| v.as_u64()).unwrap_or(1080) as u32;
    let pages = match project.get("pages").and_then(|v| v.as_array()) {
        Some(pages) if !pages.is_empty() => pages.clone(),
        _ => return Err("The project has no pages to export".into()),
    };
    let mut rendered = Vec::new();
    for page in &pages {
        let background = page.get("background").and_then(|v| v.as_str()).unwrap_or("#ffffff");
        let mut canvas = Canvas::new(width, height, parse_color(background));
        if let Some(shapes) = page.get("shapes").and_then(|v| v.as_array()) {
            for shape in shapes {
                if shape.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false) {
                    continue;
                }
                let stype = shape
                    .get("kind")
                    .or_else(|| shape.get("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let x = shape.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0) as i64;
                let y = shape.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0) as i64;
                let w = shape.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0) as i64;
                let h = shape.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0) as i64;
                let fill = shape.get("fill").and_then(|v| v.as_str()).unwrap_or("#111111");
                let opacity = shape.get("opacity").and_then(|v| v.as_f64()).unwrap_or(1.0);
                match stype.as_str() {
                    "rect" => canvas.fill_rect(x, y, w, h, parse_color(fill), opacity),
                    "circle" => canvas.fill_circle(
                        x + w / 2,
                        y + h / 2,
                        ((w.max(h).max(1)) as f64 / 2.0) as i64,
                        parse_color(fill),
                        opacity,
                    ),
                    "path" => {
                        let stroke = shape.get("stroke").and_then(|v| v.as_str()).unwrap_or("#1f2430");
                        let stroke_width = shape.get("strokeWidth").and_then(|v| v.as_f64()).unwrap_or(4.0);
                        let sx = shape.get("scaleX").and_then(|v| v.as_f64()).unwrap_or(1.0);
                        let sy = shape.get("scaleY").and_then(|v| v.as_f64()).unwrap_or(1.0);
                        if let Some(fill_color) = shape.get("fill").and_then(|v| v.as_str()) {
                            canvas.fill_path(&path_points(shape, sx, sy), x, y, parse_color(fill_color), opacity);
                        }
                        canvas.stroke_path(&path_points(shape, sx, sy), x, y, stroke_width, parse_color(stroke), opacity);
                    }
                    "image" => {
                        if let Some(src) = shape.get("src").and_then(|v| v.as_str()) {
                            match load_media(media, src) {
                                Some(data) => canvas.draw_png(&data, x, y, w, h),
                                None => canvas.fill_rect(x, y, w, h, [230, 230, 235], 1.0),
                            }
                        }
                    }
                    "text" => {
                        let text = shape.get("text").and_then(|v| v.as_str()).unwrap_or("");
                        let size = shape
                            .get("fontSize")
                            .or_else(|| shape.get("size"))
                            .and_then(|v| v.as_f64())
                            .unwrap_or(24.0);
                        canvas.draw_text(text, x, y, w.max(40) as u32, size, parse_color(fill));
                    }
                    _ => {}
                }
            }
        }
        rendered.push(canvas.to_png());
    }
    Ok(rendered)
}

/// Parse the M/L polyline path data (page-relative points already include scale).
fn path_points(shape: &Value, sx: f64, sy: f64) -> Vec<(i64, i64)> {
    let data = shape.get("data").and_then(|v| v.as_str()).unwrap_or("");
    let x = shape.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let y = shape.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let mut points = Vec::new();
    let mut tokens = data.split_whitespace();
    while let Some(command) = tokens.next() {
        let (Some(px), Some(py)) = (tokens.next(), tokens.next()) else {
            break;
        };
        let command = command.trim_start_matches(|c: char| !c.is_ascii_alphabetic());
        if command != "M" && command != "L" {
            continue;
        }
        let Ok(px) = px.parse::<f64>() else { continue };
        let Ok(py) = py.parse::<f64>() else { continue };
        points.push((x + (px * sx), y + (py * sy)));
    }
    points.into_iter().map(|(px, py)| (px.round() as i64, py.round() as i64)).collect()
}

/// Simple RGB raster canvas with PNG encoding.
pub struct Canvas {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>, // RGB triplets
}

impl Canvas {
    pub fn new(width: u32, height: u32, background: [u8; 3]) -> Canvas {
        let mut pixels = Vec::with_capacity((width * height * 3) as usize);
        for _ in 0..(width * height) {
            pixels.extend_from_slice(&background);
        }
        Canvas { width, height, pixels }
    }

    pub fn fill_rect(&mut self, x: i64, y: i64, w: i64, h: i64, color: [u8; 3], opacity: f64) {
        let x0 = x.max(0) as u32;
        let y0 = y.max(0) as u32;
        let x1 = ((x + w).max(0) as u32).min(self.width);
        let y1 = ((y + h).max(0) as u32).min(self.height);
        let blend = |bg: u8, fg: u8| -> u8 {
            ((fg as f64 * opacity + bg as f64 * (1.0 - opacity)).round() as u8).clamp(0, 255)
        };
        for py in y0..y1 {
            for px in x0..x1 {
                let idx = ((py * self.width + px) * 3) as usize;
                let bg = [self.pixels[idx], self.pixels[idx + 1], self.pixels[idx + 2]];
                self.pixels[idx] = blend(bg[0], color[0]);
                self.pixels[idx + 1] = blend(bg[1], color[1]);
                self.pixels[idx + 2] = blend(bg[2], color[2]);
            }
        }
    }

    pub fn fill_circle(&mut self, cx: i64, cy: i64, r: i64, color: [u8; 3], opacity: f64) {
        if r <= 0 {
            return;
        }
        for dy in -r..=r {
            for dx in -r..=r {
                if dx * dx + dy * dy <= r * r {
                    self.fill_rect(cx + dx, cy + dy, 1, 1, color, opacity);
                }
            }
        }
    }

    fn set_pixel(&mut self, x: i64, y: i64, color: [u8; 3], opacity: f64) {
        if x < 0 || y < 0 || x >= self.width as i64 || y >= self.height as i64 {
            return;
        }
        self.fill_rect(x, y, 1, 1, color, opacity);
    }

    fn draw_line(&mut self, x0: i64, y0: i64, x1: i64, y1: i64, thickness: f64, color: [u8; 3], opacity: f64) {
        let dx = (x1 - x0) as f64;
        let dy = (y1 - y0) as f64;
        let length = (dx * dx + dy * dy).sqrt().max(1.0);
        let steps = (length * 2.0).ceil() as i64;
        for step in 0..=steps {
            let t = step as f64 / steps as f64;
            let px = x0 as f64 + dx * t;
            let py = y0 as f64 + dy * t;
            let half = (thickness / 2.0).max(0.5);
            self.fill_rect(
                (px - half).round() as i64,
                (py - half).round() as i64,
                (half * 2.0).round() as i64,
                (half * 2.0).round() as i64,
                color,
                opacity,
            );
        }
    }

    pub fn stroke_path(&mut self, points: &[(i64, i64)], offset_x: i64, offset_y: i64, thickness: f64, color: [u8; 3], opacity: f64) {
        for pair in points.windows(2) {
            self.draw_line(
                offset_x + pair[0].0,
                offset_y + pair[0].1,
                offset_x + pair[1].0,
                offset_y + pair[1].1,
                thickness,
                color,
                opacity,
            );
        }
    }

    pub fn fill_path(&mut self, points: &[(i64, i64)], offset_x: i64, offset_y: i64, color: [u8; 3], opacity: f64) {
        if points.len() < 3 {
            return;
        }
        let page_points: Vec<(i64, i64)> = points.iter().map(|(x, y)| (offset_x + x, offset_y + y)).collect();
        let min_y = page_points.iter().map(|p| p.1).min().unwrap().max(0) as u32;
        let max_y = (page_points.iter().map(|p| p.1).max().unwrap() as u32).min(self.height);
        // Even-odd scanline fill.
        for py in min_y..max_y {
            let mut intersections: Vec<i64> = Vec::new();
            let mut a = page_points[page_points.len() - 1];
            for &b in &page_points {
                if (b.1 <= py as i64 && a.1 > py as i64) || (a.1 <= py as i64 && b.1 > py as i64) {
                    let t = (py as i64 - b.1) as f64 / (a.1 - b.1) as f64;
                    intersections.push(b.0 + ((a.0 - b.0) as f64 * t).round() as i64);
                }
                a = b;
            }
            intersections.sort_unstable();
            for pair in intersections.chunks(2) {
                if pair.len() == 2 {
                    self.fill_rect(pair[0], py as i64, pair[1] - pair[0], 1, color, opacity);
                }
            }
        }
    }

    /// 5x7 bitmap font scaled to the requested size.
    pub fn draw_text(&mut self, text: &str, x: i64, y: i64, max_width: u32, size: f64, color: [u8; 3]) {
        let scale = ((size / 7.0).round() as u32).max(1);
        let char_w = (5 * scale) as i64 + scale as i64;
        let max_chars = ((max_width as i64) / char_w).max(1) as usize;
        let line_h = (7 * scale + scale) as i64;
        let mut cursor_x = x;
        let mut cursor_y = y;
        let mut line_len = 0usize;
        for word in text.split(' ') {
            let word_width = word.chars().count() + 1; // +1 for the space
            if line_len > 0 && line_len + word_width > max_chars {
                cursor_x = x;
                cursor_y += line_h;
                line_len = 0;
            }
            for ch in word.chars() {
                if line_len >= max_chars {
                    cursor_x = x;
                    cursor_y += line_h;
                    line_len = 0;
                }
                self.draw_glyph(ch, cursor_x, cursor_y, scale, color);
                cursor_x += char_w;
                line_len += 1;
            }
            cursor_x += char_w; // space between words
            line_len += 1;
        }
    }

    fn draw_glyph(&mut self, ch: char, x: i64, y: i64, scale: u32, color: [u8; 3]) {
        let Some(rows) = glyph(ch) else { return };
        for (row, bits) in rows.iter().enumerate() {
            for col in 0..5 {
                if bits & (1 << (4 - col)) != 0 {
                    self.fill_rect(
                        x + col as i64 * scale as i64,
                        y + row as i64 * scale as i64,
                        scale as i64,
                        scale as i64,
                        color,
                        1.0,
                    );
                }
            }
        }
    }

    pub fn draw_png(&mut self, raw: &[u8], x: i64, y: i64, w: i64, h: i64) {
        let Some((pixels, pw, ph)) = crate::export::png_to_rgb(raw) else { return };
        let target_w = if w > 0 { w as u32 } else { pw };
        let target_h = if h > 0 { h as u32 } else { ph };
        for py in 0..target_h {
            for px in 0..target_w {
                let sx = (px as u64 * pw as u64 / target_w.max(1) as u64) as u32;
                let sy = (py as u64 * ph as u64 / target_h.max(1) as u64) as u32;
                let idx = ((sy * pw + sx) * 3) as usize;
                if idx + 2 >= pixels.len() {
                    continue;
                }
                let dx = x + px as i64;
                let dy = y + py as i64;
                if dx < 0 || dy < 0 || dx >= self.width as i64 || dy >= self.height as i64 {
                    continue;
                }
                let didx = ((dy as u32 * self.width + dx as u32) * 3) as usize;
                self.pixels[didx..didx + 3].copy_from_slice(&pixels[idx..idx + 3]);
            }
        }
    }

    pub fn to_png(&self) -> Vec<u8> {
        let stride = self.width as usize * 3;
        let mut raw = Vec::with_capacity(self.height as usize * (stride + 1));
        for row in 0..self.height as usize {
            raw.push(0u8);
            let start = row * stride;
            raw.extend_from_slice(&self.pixels[start..start + stride]);
        }
        let compressed = crate::export::zlib_store(&raw);
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        // IHDR
        let mut ihdr_data: Vec<u8> = Vec::new();
        ihdr_data.extend_from_slice(&self.width.to_be_bytes());
        ihdr_data.extend_from_slice(&self.height.to_be_bytes());
        ihdr_data.push(8); // bit depth
        ihdr_data.push(2); // color type RGB
        ihdr_data.extend_from_slice(&[0, 0, 0]);
        let mut ihdr_crc: Vec<u8> = b"IHDR".to_vec();
        ihdr_crc.extend_from_slice(&ihdr_data);
        out.extend_from_slice(&(ihdr_data.len() as u32).to_be_bytes());
        out.extend_from_slice(&ihdr_crc);
        out.extend_from_slice(&crate::export::crc32(&ihdr_crc).to_be_bytes());
        // IDAT
        let mut idat_crc: Vec<u8> = b"IDAT".to_vec();
        idat_crc.extend_from_slice(&compressed);
        out.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
        out.extend_from_slice(&idat_crc);
        out.extend_from_slice(&crate::export::crc32(&idat_crc).to_be_bytes());
        // IEND
        out.extend_from_slice(&0u32.to_be_bytes());
        out.extend_from_slice(b"IEND");
        out.extend_from_slice(&crate::export::crc32(b"IEND").to_be_bytes());
        out
    }
}

fn glyph(ch: char) -> Option<&'static [u8; 7]> {
    let upper = ch.to_ascii_uppercase();
    Some(match upper {
        'A' => &[0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
        'B' => &[0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
        'C' => &[0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
        'D' => &[0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C],
        'E' => &[0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
        'F' => &[0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
        'G' => &[0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F],
        'H' => &[0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
        'I' => &[0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
        'J' => &[0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
        'K' => &[0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
        'L' => &[0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
        'M' => &[0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11],
        'N' => &[0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
        'O' => &[0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
        'P' => &[0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
        'Q' => &[0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D],
        'R' => &[0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
        'S' => &[0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E],
        'T' => &[0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
        'U' => &[0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
        'V' => &[0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
        'W' => &[0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A],
        'X' => &[0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
        'Y' => &[0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04],
        'Z' => &[0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
        '0' => &[0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
        '1' => &[0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
        '2' => &[0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F],
        '3' => &[0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
        '4' => &[0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
        '5' => &[0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
        '6' => &[0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
        '7' => &[0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
        '8' => &[0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
        '9' => &[0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
        ' ' => &[0x00; 7],
        '.' => &[0x00, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x0C],
        ',' => &[0x00, 0x00, 0x00, 0x00, 0x0C, 0x04, 0x08],
        '-' => &[0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00],
        ':' => &[0x00, 0x0C, 0x0C, 0x00, 0x0C, 0x0C, 0x00],
        '!' => &[0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
        '?' => &[0x0E, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
        '/' => &[0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
        '(' => &[0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
        ')' => &[0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
        _ => return None,
    })
}

fn call_tool(deps: &Deps, name: &str, arguments: Option<&Value>) -> Value {
    // Kind-specific tool aliases share the generic implementations.
    let name = match name {
        "create_document" | "create_video" => {
            let mut args = arguments.cloned().unwrap_or(json!({}));
            if args.get("kind").is_none() {
                args["kind"] = json!(if name == "create_video" { "videos" } else { "documents" });
            }
            return call_tool(deps, "create_project", Some(&args));
        }
        "update_document" | "update_video" => return call_tool(deps, "update_project", arguments),
        "delete_document" | "delete_video" => return call_tool(deps, "delete_project", arguments),
        other => other,
    };
    match name {
        "list_projects" => match folder(&deps.shared).map(|f| store::scan(&f)) {
            Ok(projects) => text_result(json!({ "projects": projects })),
            Err(error) => error_result(&error),
        },
        "read_project" => {
            let path = match arg(arguments, "path") {
                    Ok(path) => PathBuf::from(path),
                    Err(message) => return error_result(&message),
                };
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str::<Value>(&content) {
                    Ok(value) => text_result(value),
                    Err(_) => text_raw(&content),
                },
                Err(error) => error_result(&error.to_string()),
            }
        }
        "update_project" => {
            let path = match arg(arguments, "path") {
                    Ok(path) => PathBuf::from(path),
                    Err(message) => return error_result(&message),
                };
            let content = match arg(arguments, "content") {
                Ok(content) => content,
                Err(message) => return error_result(&message),
            };
            if path.extension().and_then(|e| e.to_str()) != Some("dupo") {
                return error_result("Only .dupo project files can be updated");
            }
            if let Err(error) = serde_json::from_str::<Value>(&content) {
                return error_result(&format!("The content is not valid JSON: {error}"));
            }
            match fs::write(&path, content) {
                Ok(()) => text_result(json!({ "ok": true })),
                Err(error) => error_result(&error.to_string()),
            }
        }
        "create_project" => {
            let name = match arg(arguments, "name") {
                Ok(name) => name,
                Err(message) => return error_result(&message),
            };
            let kind = arguments
                .and_then(|a| a.get("kind"))
                .and_then(|v| v.as_str())
                .unwrap_or("documents")
                .to_string();
            let width = arguments.and_then(|a| a.get("width")).and_then(|v| v.as_f64()).unwrap_or(1080.0);
            let height = arguments.and_then(|a| a.get("height")).and_then(|v| v.as_f64()).unwrap_or(1080.0);
            let created = (|| -> Result<ProjectMeta, String> {
                if !matches!(kind.as_str(), "documents" | "presentations" | "videos") {
                    return Err("Unknown project kind".into());
                }
                let name = name.trim();
                if name.is_empty() {
                    return Err("Give the project a name".into());
                }
                let dir = folder(&deps.shared)?;
                let is_video = kind == "videos";
                let payload = json!({
                    "version": if is_video { 2 } else { 1 },
                    "kind": kind,
                    "name": name,
                    "preset": "custom",
                    "width": width.round() as u32,
                    "height": height.round() as u32,
                    "pages": if is_video { json!([]) } else { json!([{ "id": store::now_id("p"), "background": "#ffffff", "shapes": [] }]) },
                    "tracks": if is_video {
                        json!([{ "id": store::now_id("t"), "kind": "video", "name": "Video 1", "clips": [] }])
                    } else {
                        json!([])
                    },
                    "texts": []
                });
                let path = store::unique_path(&dir, name, "dupo");
                fs::write(&path, serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?)
                    .map_err(|e| format!("Could not create the project: {e}"))?;
                let updated_at = fs::metadata(&path)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                Ok(ProjectMeta {
                    id: path.to_string_lossy().into_owned(),
                    kind: kind.clone(),
                    name: name.to_string(),
                    path: path.to_string_lossy().into_owned(),
                    width: width.round(),
                    height: height.round(),
                    updated_at,
                })
            })();
            match created {
                Ok(project) => text_result(json!({ "project": project })),
                Err(error) => error_result(&error),
            }
        }
        "delete_project" => {
            let path = match arg(arguments, "path") {
                    Ok(path) => PathBuf::from(path),
                    Err(message) => return error_result(&message),
                };
            if path.extension().and_then(|e| e.to_str()) != Some("dupo") {
                return error_result("Refusing to delete a non-project file");
            }
            match fs::remove_file(path) {
                Ok(()) => text_result(json!({ "ok": true })),
                Err(error) => error_result(&error.to_string()),
            }
        }
        "update_page" => {
            let path = match arg(arguments, "path") {
                Ok(path) => PathBuf::from(path),
                Err(message) => return error_result(&message),
            };
            let index = arguments
                .and_then(|a| a.get("page"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let project_raw = match fs::read_to_string(&path) {
                Ok(raw) => raw,
                Err(error) => return error_result(&error.to_string()),
            };
            let mut project: Value = match serde_json::from_str(&project_raw) {
                Ok(value) => value,
                Err(error) => return error_result(&format!("Could not parse the project: {error}")),
            };
            let pages = match project.get_mut("pages").and_then(|v| v.as_array_mut()) {
                Some(pages) if !pages.is_empty() => pages,
                _ => return error_result("The project has no pages to update"),
            };
            let index = index.round().max(0.0) as usize;
            if index >= pages.len() {
                return error_result(&format!("Page {index} does not exist (the project has {} pages)", pages.len()));
            }
            let page = &mut pages[index];
            if let Some(background) = arguments.and_then(|a| a.get("background")).and_then(|v| v.as_str()) {
                page["background"] = json!(background);
            }
            if let Some(shapes) = arguments.and_then(|a| a.get("shapes")) {
                if !shapes.is_array() {
                    return error_result("shapes must be an array");
                }
                page["shapes"] = shapes.clone();
            }
            match serde_json::to_string_pretty(&project) {
                Ok(content) => match fs::write(&path, content) {
                    Ok(()) => text_result(json!({ "ok": true, "page": index })),
                    Err(error) => error_result(&error.to_string()),
                },
                Err(error) => error_result(&error.to_string()),
            }
        }
        "get_page_shot" => {
            let path = match arg(arguments, "path") {
                Ok(path) => PathBuf::from(path),
                Err(message) => return error_result(&message),
            };
            let index = arguments
                .and_then(|a| a.get("page"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
                .round()
                .max(0.0) as usize;
            let project_raw = match fs::read_to_string(&path) {
                Ok(raw) => raw,
                Err(error) => return error_result(&error.to_string()),
            };
            let project: Value = match serde_json::from_str(&project_raw) {
                Ok(value) => value,
                Err(error) => return error_result(&format!("Could not parse the project: {error}")),
            };
            let media = path
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."));
            let rendered = match render_pages(&project, &media) {
                Ok(pages) => pages,
                Err(error) => return error_result(&error),
            };
            if index >= rendered.len() {
                return error_result(&format!("Page {index} does not exist (the project has {} pages)", rendered.len()));
            }
            json!({
                "content": [{
                    "type": "image",
                    "data": base64_encode(&rendered[index]),
                    "mimeType": "image/png"
                }]
            })
        }
        "export_project" => {
            let path = match arg(arguments, "path") {
                    Ok(path) => PathBuf::from(path),
                    Err(message) => return error_result(&message),
                };
            let format = arguments
                .and_then(|a| a.get("format"))
                .and_then(|v| v.as_str())
                .unwrap_or("pdf")
                .to_string();
            let output = optional_str(arguments, "output");
            let project_raw = match fs::read_to_string(&path) {
                Ok(raw) => raw,
                Err(error) => return error_result(&error.to_string()),
            };
            let project: Value = match serde_json::from_str(&project_raw) {
                Ok(value) => value,
                Err(error) => return error_result(&format!("Could not parse the project: {error}")),
            };
            let media = path
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."));
            let pages = match render_pages(&project, &media) {
                Ok(pages) => pages,
                Err(error) => return error_result(&error),
            };
            let base: Vec<String> = pages.iter().map(|p| base64_encode(p)).collect();
            let result = match output {
                Some(destination) => {
                    let target = destination.clone();
                    crate::export::export_to_path(&format, &base, &PathBuf::from(destination))
                        .map(|_| target)
                }
                None => folder(&deps.shared).and_then(|dir| {
                    crate::export::export_to(
                        &dir,
                        project.get("name").and_then(|v| v.as_str()).unwrap_or("export"),
                        &format,
                        &base,
                    )
                }),
            };
            match result {
                Ok(saved_to) => text_result(json!({ "savedTo": saved_to, "format": format, "pages": pages.len() })),
                Err(error) => error_result(&error),
            }
        }
        other => error_result(&format!("Unknown tool: {other}")),
    }
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).map(|v| *v as u32);
        let b2 = chunk.get(2).map(|v| *v as u32);
        let n = (b0 << 16) | (b1.unwrap_or(0) << 8) | b2.unwrap_or(0);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if b1.is_some() { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if b2.is_some() { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

// ---------------------------------------------------------------------------
// HTTP plumbing

fn host_allowed(headers: &[(String, String)]) -> bool {
    headers.iter().any(|(key, value)| {
        key.eq_ignore_ascii_case("host")
            && (value.starts_with("127.0.0.1") || value.starts_with("localhost"))
    })
}

fn origin_allowed(headers: &[(String, String)]) -> bool {
    headers.iter().any(|(key, value)| {
        key.eq_ignore_ascii_case("origin")
            && (value.starts_with("http://127.0.0.1") || value.starts_with("http://localhost"))
    })
}

fn read_request(stream: &mut TcpStream) -> Option<(String, String, Vec<(String, String)>, Vec<u8>)> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line).ok()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).ok()?;
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            headers.push((key.trim().to_string(), value.trim().to_string()));
        }
    }
    let length = headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = vec![0u8; length];
    if length > 0 {
        reader.read_exact(&mut body).ok()?;
    }
    Some((method, target, headers, body))
}

fn write_response(stream: &mut TcpStream, status: &str, headers: &str, body: &[u8]) {
    let response = format!(
        "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn rpc_ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn dispatch(deps: &Deps, request: &Value) -> Option<Value> {
    let method = request.get("method")?.as_str()?;
    let has_id = request.get("id").map(|v| !v.is_null()).unwrap_or(false);
    if !has_id {
        return None; // Notification: nothing to answer.
    }
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let params = request.get("params").cloned().unwrap_or(json!({}));
    let result = match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(|v| v.as_str()).unwrap_or("");
            let version = if ACCEPTED_PROTOCOLS.contains(&asked) { asked } else { PROTOCOL };
            json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "dupo", "title": "Dupo", "version": env!("CARGO_PKG_VERSION") }
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let arguments = params.get("arguments");
            call_tool(deps, name, arguments)
        }
        other => return Some(rpc_error(id, -32601, &format!("Method not found: {other}"))),
    };
    Some(rpc_ok(id, result))
}

fn handle_stream(deps: Deps, mut stream: TcpStream) {
    let Some((method, target, headers, body)) = read_request(&mut stream) else {
        return;
    };
    if !host_allowed(&headers) {
        write_response(&mut stream, "403 Forbidden", "", b"invalid host");
        return;
    }
    if !origin_allowed(&headers) {
        write_response(&mut stream, "403 Forbidden", "Access-Control-Allow-Origin: *\r\n", b"invalid origin");
        return;
    }
    if method == "OPTIONS" {
        write_response(
            &mut stream,
            "204 No Content",
            "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, GET, DELETE\r\nAccess-Control-Allow-Headers: content-type, mcp-session-id, mcp-protocol-version, authorization\r\n",
            b"",
        );
        return;
    }
    if method == "DELETE" {
        write_response(&mut stream, "200 OK", "Access-Control-Allow-Origin: *\r\n", b"{}");
        return;
    }
    if method != "POST" || !(target == "/mcp" || target == "/mcp/") {
        write_response(&mut stream, "404 Not Found", "", b"not found");
        return;
    }
    let request: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => {
            write_response(
                &mut stream,
                "400 Bad Request",
                "Content-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n",
                b"{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32700,\"message\":\"Parse error\"}}",
            );
            return;
        }
    };
    match dispatch(&deps, &request) {
        Some(response) => {
            let payload = serde_json::to_vec(&response).unwrap_or_else(|_| b"{}".to_vec());
            write_response(
                &mut stream,
                "200 OK",
                "Content-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: Mcp-Session-Id\r\n",
                &payload,
            );
        }
        None => {
            write_response(&mut stream, "202 Accepted", "Access-Control-Allow-Origin: *\r\n", b"");
        }
    }
}

pub fn serve(deps: Deps) -> Result<Running, String> {
    let listener = TcpListener::bind(("127.0.0.1", DEFAULT_PORT))
        .map_err(|error| format!("Could not start the MCP server on port {DEFAULT_PORT}: {error}"))?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    let handle = std::thread::spawn(move || {
        listener.set_nonblocking(true).ok();
        while !stop_flag.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _addr)) => {
                    stream.set_nodelay(true).ok();
                    let deps = deps.clone();
                    std::thread::spawn(move || handle_stream(deps, stream));
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(40));
                }
                Err(_) => std::thread::sleep(Duration::from_millis(200)),
            }
        }
    });
    Ok(Running { stop, handle: Some(handle) })
}
