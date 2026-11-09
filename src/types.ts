export type ProjectKind = "documents" | "videos" | "presentations";

export type ProjectMeta = {
  id: string;
  kind: ProjectKind;
  name: string;
  /** Path to the .dupo file on disk. */
  path: string;
  width: number;
  height: number;
  updatedAt: number;
};

export type Settings = {
  projectsFolder: string;
  theme: "dark" | "light";
  mcpEnabled: boolean;
};

export type Snapshot = {
  settings: Settings;
  projects: ProjectMeta[];
  mcp: McpStatus;
};

export type McpStatus = {
  running: boolean;
  port: number;
  url: string;
  claude: string;
  codex: string;
  opencode: string;
};

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

export function formatDate(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
