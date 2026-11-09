export type VideoClip = {
  id: string;
  name: string;
  src: string;
  start: number;
  duration: number;
};

export type AudioClip = {
  id: string;
  name: string;
  src: string;
  start: number;
  duration: number;
};

export type VideoTrack = {
  id: string;
  kind: "video";
  name: string;
  clips: VideoClip[];
};

export type AudioTrack = {
  id: string;
  kind: "audio";
  name: string;
  clips: AudioClip[];
};

export type TimelineTrack = VideoTrack | AudioTrack;

export type TextClip = {
  id: string;
  text: string;
  start: number;
  duration: number;
  x: number;
  y: number;
  fontSize: number;
  fill: string;
};

export type VideoProject = {
  version: 2;
  kind: "videos";
  name: string;
  preset: string;
  width: number;
  height: number;
  tracks: TimelineTrack[];
  texts: TextClip[];
};

let trackCounter = 0;

export function trackId(): string {
  trackCounter += 1;
  return `t${Date.now().toString(36)}${trackCounter.toString(36)}`;
}

export function blankVideoTrack(index: number): VideoTrack {
  return { id: trackId(), kind: "video", name: `Video ${index + 1}`, clips: [] };
}

export function blankAudioTrack(index: number): AudioTrack {
  return { id: trackId(), kind: "audio", name: `Audio ${index + 1}`, clips: [] };
}

export function blankVideo(name: string, preset: string, width: number, height: number): VideoProject {
  return { version: 2, kind: "videos", name, preset, width, height, tracks: [blankVideoTrack(0)], texts: [] };
}

function parseTrack(row: Record<string, unknown>): TimelineTrack | null {
  const kind = row.kind === "audio" ? "audio" : row.kind === "video" ? "video" : null;
  if (!kind) return null;
  const clips: (VideoClip | AudioClip)[] = [];
  if (Array.isArray(row.clips)) {
    for (const rawClip of row.clips) {
      if (!rawClip || typeof rawClip !== "object") continue;
      const item = rawClip as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id : "";
      const src = typeof item.src === "string" ? item.src : "";
      if (!id || !src) continue;
      clips.push({
        id,
        name: typeof item.name === "string" ? item.name.slice(0, 120) : "clip",
        src,
        start: Math.max(0, Number(item.start) || 0),
        duration: Math.max(0.1, Number(item.duration) || 5),
      });
    }
  }
  return kind === "video"
    ? { id: typeof row.id === "string" && row.id ? row.id : trackId(), kind, name: typeof row.name === "string" ? row.name.slice(0, 60) : "Video", clips }
    : { id: typeof row.id === "string" && row.id ? row.id : trackId(), kind, name: typeof row.name === "string" ? row.name.slice(0, 60) : "Audio", clips };
}

export function parseVideo(raw: string): VideoProject | null {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    if (value.kind !== "videos") return null;
    if (value.version !== 1 && value.version !== 2) return null;
    if (typeof value.name !== "string") return null;
    const width = Math.round(Number(value.width));
    const height = Math.round(Number(value.height));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16) return null;

    let tracks: TimelineTrack[] = [];
    if (Array.isArray(value.tracks)) {
      const rawTracks: unknown[] = value.tracks;
      tracks = rawTracks
        .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
        .map(parseTrack)
        .filter((track): track is TimelineTrack => track !== null);
    } else if (Array.isArray(value.clips)) {
      const migrated: TimelineTrack[] = [];
      for (const row of value.clips) {
        if (!row || typeof row !== "object") continue;
        const item = row as Record<string, unknown>;
        const id = typeof item.id === "string" ? item.id : "";
        const src = typeof item.src === "string" ? item.src : "";
        if (!id || !src) continue;
        migrated.push({
          id: trackId(),
          kind: "video",
          name: "Video 1",
          clips: [{
            id,
            name: typeof item.name === "string" ? item.name.slice(0, 120) : "clip",
            src,
            start: Math.max(0, Number(item.start) || 0),
            duration: Math.max(0.1, Number(item.duration) || 5),
          }],
        });
      }
      tracks = migrated;
    }
    if (!tracks.some((track) => track.kind === "video")) {
      tracks.unshift(blankVideoTrack(0));
    }

    const texts: TextClip[] = [];
    if (Array.isArray(value.texts)) {
      for (const row of value.texts) {
        if (!row || typeof row !== "object") continue;
        const item = row as Record<string, unknown>;
        const id = typeof item.id === "string" ? item.id : "";
        if (!id) continue;
        texts.push({
          id,
          text: typeof item.text === "string" ? item.text : "",
          start: Math.max(0, Number(item.start) || 0),
          duration: Math.max(0.1, Number(item.duration) || 3),
          x: Number(item.x) || 80,
          y: Number(item.y) || 80,
          fontSize: Math.max(8, Number(item.fontSize) || 48),
          fill: /^#[0-9a-fA-F]{3,8}$/.test(String(item.fill)) ? String(item.fill) : "#ffffff",
        });
      }
    }
    return {
      version: 2,
      kind: "videos",
      name: value.name.slice(0, 120),
      preset: typeof value.preset === "string" ? value.preset : "custom",
      width,
      height,
      tracks,
      texts,
    };
  } catch {
    return null;
  }
}

export function videoTracks(project: VideoProject): VideoTrack[] {
  return project.tracks.filter((track): track is VideoTrack => track.kind === "video");
}

export function audioTracks(project: VideoProject): AudioTrack[] {
  return project.tracks.filter((track): track is AudioTrack => track.kind === "audio");
}

export function videoDuration(project: VideoProject): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
  }
  for (const text of project.texts) end = Math.max(end, text.start + text.duration);
  return end;
}

export function timecode(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}
