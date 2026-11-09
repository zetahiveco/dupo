import { invoke } from "@tauri-apps/api/core";
import type { McpStatus, ProjectMeta, Settings, Snapshot } from "./types";

export async function getSnapshot(): Promise<Snapshot> {
  return invoke<Snapshot>("get_snapshot");
}

export async function reloadProjects(path: string): Promise<ProjectMeta[]> {
  return invoke<ProjectMeta[]>("reload_projects", { path });
}

export async function saveSettings(settings: Settings): Promise<Snapshot> {
  return invoke<Snapshot>("save_settings", { settings });
}

export async function readProject(path: string): Promise<string> {
  return invoke<string>("read_project", { path });
}

export async function writeProject(path: string, content: string): Promise<void> {
  await invoke("write_project", { path, content });
}

export async function createProject(
  kind: string,
  name: string,
  preset: string,
  width: number,
  height: number,
): Promise<ProjectMeta> {
  return invoke<ProjectMeta>("create_project", { newProject: { kind, name, preset, width, height } });
}

export async function deleteProject(path: string): Promise<void> {
  await invoke("delete_project", { path });
}

export async function saveMedia(path: string, base64: string): Promise<string> {
  return invoke<string>("save_media", { path, base64 });
}

export const VIDEO_MAX_BYTES = 300 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export async function importMedia(path: string, maxBytes?: number): Promise<string> {
  return invoke<string>("import_media", { path, maxBytes });
}

export async function mcpStatus(): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_status");
}

export async function mcpStart(): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_start");
}

export async function mcpStop(): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_stop");
}

type Picked = { path: string | null; canceled: boolean };

function unwrapPicked(picked: Picked): string | null {
  return picked.path && !picked.canceled ? picked.path : null;
}

export async function pickFolder(title: string): Promise<string | null> {
  return invoke<Picked>("pick_folder", { title }).then(unwrapPicked);
}

export async function pickFile(filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  const title = filters[0]?.name ?? "Pick a file";
  const extensions = filters.flatMap((filter) => filter.extensions);
  return invoke<Picked>("pick_file", { title, extensions }).then(unwrapPicked);
}
