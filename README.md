# Dupo

**Dupo** is a Canva-style design studio for your desktop. Create documents, presentations, and videos with a drag-and-drop editor, export them anywhere, and let local AI agents work on your projects through a built-in MCP server.

Built with [Tauri 2](https://v2.tauri.app/) — small binary, native performance, your files stay on your machine.

## Features

### 🎨 Canva-style editor
- Drag, resize, and rotate text, shapes, and images on an infinite canvas
- Layers, duplicate, undo/redo, zoom
- Page backgrounds with a color picker
- Image import (PNG, JPG, GIF, WebP, SVG)

### 📄 Documents & presentations
- Page-based projects with presets: **LinkedIn Post, LinkedIn Carousel, Instagram Post/Story, X Post, YouTube Thumbnail, A4, US Letter, Presentation 16:9 / 4:3**, or fully custom dimensions
- Present mode for presentations
- Export to **PDF, PPTX (PowerPoint), or PNG images**

### 🎬 Video editor
- Timeline-based clip editor for 1080p and vertical (9:16) video projects

### 🔌 Built-in MCP server
Dupo ships with a [Model Context Protocol](https://modelcontextprotocol.io) server so local AI agents (Claude, Codex, OpenCode, …) can read and edit your projects and export files on your behalf.

Enable it in **Settings → MCP server**, then connect your agent:

```sh
claude mcp add --transport http dupo http://127.0.0.1:47330/mcp
```

Available tools:

| Tool | Description |
| --- | --- |
| `list_projects` | List projects with kind, dimensions, and paths |
| `read_project` | Read the full JSON content of a `.dupo` project |
| `update_project` | Write project content back to disk |
| `create_project` | Create a new document, presentation, or video project |
| `delete_project` | Delete a project file |
| `export_project` | Export a project to PDF, PPTX, or PNG |

The server listens on `127.0.0.1` only, validates `Host`/`Origin` headers, and can auto-start with the app (Settings → MCP server → toggle).

### 📁 Projects
- Projects are plain JSON files with a `.dupo` extension, stored in `~/Documents/Dupo` by default (change it in Settings)
- Media used by projects lives in a `media/` folder next to your projects
- The start screen lets you pick your **Documents** or **Videos** workspace and jump straight in

## Install

### macOS / Linux (curl)

```sh
curl -fsSL https://getdupo.vercel.app/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://getdupo.vercel.app/install.ps1 | iex
```

### Build from source

Requires [Node.js 20+](https://nodejs.org), the [Rust toolchain](https://rustup.rs), and platform prerequisites for Tauri ([see here](https://v2.tauri.app/start/prerequisites/)).

```sh
git clone https://github.com/zetahiveco/dupo.git
cd dupo
npm install
npm run tauri dev     # run in development
npm run tauri build   # produce an installable bundle
```

## Website

Project page: [getdupo.vercel.app](https://getdupo.vercel.app) (source in [`website/`](./website)).

## License

[MIT](./LICENSE)
