import { useEffect, useRef, useState } from "react";
import {
  audioTracks,
  blankAudioTrack,
  blankVideoTrack,
  blankVideo,
  parseVideo,
  timecode,
  videoDuration,
  videoTracks,
  type VideoProject,
} from "../video-model";
import { pickFile, VIDEO_MAX_BYTES, writeProject, importMedia } from "../api";
import { errorMessage, type ProjectMeta } from "../types";
import {
  PiArrowClockwise,
  PiArrowCounterClockwise,
  PiPause,
  PiPlay,
  PiPlus,
  PiTextT,
  PiTrash,
  PiX,
} from "react-icons/pi";

type Props = {
  meta: ProjectMeta;
  raw: string;
  onBack: () => void;
};

type SnapshotState = { past: VideoProject[]; future: VideoProject[] };

export function VideoEditor({ meta, raw, onBack }: Props) {
  const [project, setProject] = useState<VideoProject>(() => parseVideo(raw) ?? blankVideo(meta.name, "video-1080p", meta.width, meta.height));
  const [history, setHistory] = useState<SnapshotState>({ past: [], future: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [toast, setToast] = useState("");
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  const timerRef = useRef<number | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; frame: DOMRect; moved: boolean } | null>(null);
  const projectRef = useRef(project);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const total = Math.max(1, videoDuration(project));

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!playing) return;
    timerRef.current = window.setInterval(() => {
      setPlayhead((t) => {
        const next = t + 0.1;
        if (next >= total) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
    }, 100);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [playing, total]);

  // Keep audio clips in sync with the playhead while playing or scrubbing.
  useEffect(() => {
    for (const track of audioTracks(project)) {
      for (const clip of track.clips) {
        const audio = audioRefs.current.get(clip.id);
        if (!audio) continue;
        const inRange = playhead >= clip.start && playhead < clip.start + clip.duration;
        if (playing && inRange) {
          const offset = playhead - clip.start;
          if (Math.abs(audio.currentTime - offset) > 0.3) audio.currentTime = offset;
          void audio.play().catch(() => {});
        } else if (!audio.paused) {
          audio.pause();
        }
      }
    }
  }, [playing, playhead, project]);

  function record(next: VideoProject) {
    setHistory((h) => ({ past: [...h.past, project].slice(-40), future: [] }));
    setProject(next);
    void writeProject(meta.path, JSON.stringify(next, null, 2)).catch(() => setToast("Could not save"));
  }

  function undo() {
    setHistory((h) => {
      const previous = h.past[h.past.length - 1];
      if (!previous) return h;
      setProject(previous);
      return { past: h.past.slice(0, -1), future: [project, ...h.future].slice(0, 40) };
    });
  }

  function redo() {
    setHistory((h) => {
      const next = h.future[0];
      if (!next) return h;
      setProject(next);
      return { past: [...h.past, project].slice(-40), future: h.future.slice(1) };
    });
  }

  async function addMedia(kind: "video" | "audio") {
    try {
      const filters = kind === "video"
        ? [{ name: "Video", extensions: ["mp4", "mov", "webm", "mkv"] }]
        : [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"] }];
      const picked = await pickFile(filters);
      if (!picked) return;
      const name = picked.split(/[\\/]/).pop() ?? "clip";
      const stored = await importMedia(picked, VIDEO_MAX_BYTES);
      const src = `media://localhost/${encodeURIComponent(stored)}`;
      const probe = document.createElement(kind === "video" ? "video" : "audio");
      probe.src = src;
      const duration = await new Promise<number>((resolve) => {
        probe.onloadedmetadata = () => resolve(probe.duration || 5);
        probe.onerror = () => resolve(5);
      });
      const id = Math.random().toString(36).slice(2, 10);
      const clip = { id, name, src, start: videoDuration(project), duration: Math.round(duration * 10) / 10 };
      let appended = false;
      const tracks = project.tracks.map((track) => {
        const matchesKind = kind === "video" ? track.kind === "video" : track.kind === "audio";
        if (appended || !matchesKind) return track;
        appended = true;
        return { ...track, clips: [...track.clips, clip] };
      });
      if (!appended) {
        const count = project.tracks.filter((track) => track.kind === kind).length;
        tracks.push(kind === "video" ? { ...blankVideoTrack(count), clips: [clip] } : { ...blankAudioTrack(count), clips: [clip] });
      }
      record({ ...project, tracks });
    } catch (error) {
      setToast(errorMessage(error));
    }
  }

  function addTrack(kind: "video" | "audio") {
    const count = project.tracks.filter((track) => track.kind === kind).length;
    const newTrack = kind === "video" ? blankVideoTrack(count) : blankAudioTrack(count);
    if (kind === "audio") {
      record({ ...project, tracks: [...project.tracks, newTrack] });
      return;
    }
    const lastVideoIndex = project.tracks.map((track) => track.kind).lastIndexOf("video");
    const tracks = [...project.tracks];
    tracks.splice(lastVideoIndex + 1, 0, newTrack);
    record({ ...project, tracks });
  }

  function removeTrack(trackIdToRemove: string) {
    const track = project.tracks.find((t) => t.id === trackIdToRemove);
    if (!track) return;
    if (track.kind === "video" && videoTracks(project).length <= 1) return;
    record({ ...project, tracks: project.tracks.filter((t) => t.id !== trackIdToRemove) });
    setSelected(null);
  }

  function addText() {
    const id = Math.random().toString(36).slice(2, 10);
    record({
      ...project,
      texts: [
        ...project.texts,
        {
          id,
          text: "Caption",
          start: playhead,
          duration: 3,
          x: Math.round(project.width * 0.2),
          y: Math.round(project.height * 0.8),
          fontSize: 48,
          fill: "#ffffff",
        },
      ],
    });
    setSelected(id);
  }

  function deleteSelected() {
    if (!selected) return;
    record({
      ...project,
      tracks: project.tracks.map((track) => ({ ...track, clips: track.clips.filter((clip) => clip.id !== selected) })),
      texts: project.texts.filter((text) => text.id !== selected),
    });
    setSelected(null);
  }

  const selectedText = project.texts.find((t) => t.id === selected) ?? null;

  return (
    <div className="editor-shell">
      <div className="editor-topbar">
        <button className="icon-btn" title="Back to projects" onClick={onBack}>
          <PiX size={16} />
        </button>
        <div className="editor-title">
          <strong>{project.name}</strong>
          <span className="muted-note">{timecode(total)} total</span>
        </div>
        <div className="toolbar-actions">
          <button className="text-btn" onClick={() => addMedia("video")}>
            <PiPlus size={15} /> Video
          </button>
          <button className="text-btn" onClick={() => addMedia("audio")}>
            <PiPlus size={15} /> Audio
          </button>
          <button className="text-btn" onClick={addText}>
            <PiTextT size={15} /> Text
          </button>
          <button className="icon-btn danger" title="Delete selected" onClick={deleteSelected} disabled={!selected}>
            <PiTrash size={16} />
          </button>
        </div>
      </div>
      <div className="editor-body">
        <div className="canvas-scroll video-stage">
          <div
            ref={frameRef}
            className="video-frame"
            style={{ aspectRatio: `${project.width} / ${project.height}`, maxWidth: "100%", maxHeight: "100%" }}
          >
            {videoTracks(project)
              .reverse()
              .flatMap((track) =>
                track.clips.map((clip) => {
                  const visible = playhead >= clip.start && playhead < clip.start + clip.duration;
                  return (
                    <video
                      key={clip.id}
                      ref={(el) => {
                        if (el) videoRefs.current.set(clip.id, el);
                        else videoRefs.current.delete(clip.id);
                      }}
                      src={clip.src}
                      className="video-layer"
                      style={{ display: visible ? "block" : "none" }}
                      muted
                    />
                  );
                }),
              )}
            {audioTracks(project).flatMap((track) =>
              track.clips.map((clip) => (
                <audio
                  key={clip.id}
                  ref={(el) => {
                    if (el) audioRefs.current.set(clip.id, el);
                    else audioRefs.current.delete(clip.id);
                  }}
                  src={clip.src}
                  hidden
                />
              )),
            )}
            {project.texts
              .filter((text) => playhead >= text.start && playhead < text.start + text.duration)
              .map((text) => (
                <button
                  key={text.id}
                  className={"video-caption" + (selected === text.id ? " selected" : "")}
                  style={{
                    left: `${(text.x / project.width) * 100}%`,
                    top: `${(text.y / project.height) * 100}%`,
                    fontSize: Math.max(12, text.fontSize * 0.4),
                    color: text.fill,
                  }}
                  onClick={() => setSelected(text.id)}
                  onPointerDown={(event) => {
                    const frame = frameRef.current?.getBoundingClientRect();
                    if (!frame) return;
                    event.preventDefault();
                    setSelected(text.id);
                    dragRef.current = {
                      id: text.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      origX: text.x,
                      origY: text.y,
                      frame,
                      moved: false,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const drag = dragRef.current;
                    if (!drag || drag.id !== text.id) return;
                    drag.moved = true;
                    const x = Math.round(drag.origX + ((event.clientX - drag.startX) / drag.frame.width) * project.width);
                    const y = Math.round(drag.origY + ((event.clientY - drag.startY) / drag.frame.height) * project.height);
                    setProject((p) => ({
                      ...p,
                      texts: p.texts.map((t) => (t.id === drag.id ? { ...t, x, y } : t)),
                    }));
                  }}
                  onPointerUp={(event) => {
                    const drag = dragRef.current;
                    if (!drag || drag.id !== text.id) return;
                    dragRef.current = null;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    if (drag.moved) record(projectRef.current);
                  }}
                >
                  {text.text}
                </button>
              ))}
          </div>
        </div>
        <div className="insert-panel">
          {selectedText ? (
            <>
              <div className="panel-title">Caption</div>
              <textarea
                className="field"
                rows={2}
                value={selectedText.text}
                onChange={(event) =>
                  setProject((p) => ({
                    ...p,
                    texts: p.texts.map((t) => (t.id === selectedText.id ? { ...t, text: event.target.value } : t)),
                  }))
                }
                onBlur={() => record(project)}
              />
              <label className="color-row">
                <span>Color</span>
                <input
                  type="color"
                  value={selectedText.fill}
                  onChange={(event) =>
                    record({
                      ...project,
                      texts: project.texts.map((t) => (t.id === selectedText.id ? { ...t, fill: event.target.value } : t)),
                    })
                  }
                />
              </label>
            </>
          ) : (
            <div className="muted-note" style={{ padding: 12 }}>
              Add a video or text clip, then drag it along the timeline. Click a caption to edit it.
            </div>
          )}
        </div>
      </div>
      <div className="video-timeline">
        <div className="timeline-controls">
          <button className="icon-btn" title="Undo" onClick={undo} disabled={history.past.length === 0}>
            <PiArrowCounterClockwise size={16} />
          </button>
          <button className="icon-btn" title="Redo" onClick={redo} disabled={history.future.length === 0}>
            <PiArrowClockwise size={16} />
          </button>
          <button
            className="icon-btn"
            title={playing ? "Pause" : "Play"}
            onClick={() => {
              setPlaying((p) => !p);
              if (!playing) {
                for (const video of videoRefs.current.values()) void video.play().catch(() => {});
              } else {
                for (const video of videoRefs.current.values()) video.pause();
              }
            }}
          >
            {playing ? <PiPause size={16} /> : <PiPlay size={16} />}
          </button>
          <span className="zoom-label">{timecode(playhead)}</span>
          <button className="text-btn" onClick={() => addTrack("video")} title="Add a video track">
            <PiPlus size={13} /> Video track
          </button>
          <button className="text-btn" onClick={() => addTrack("audio")} title="Add an audio track">
            <PiPlus size={13} /> Audio track
          </button>
        </div>
        <div className="timeline-rows">
          {project.tracks.map((track) => (
            <div className="timeline-row" key={track.id}>
              <div className="timeline-label">
                <span>{track.name}</span>
                {project.tracks.length > 1 ? (
                  <button className="icon-btn danger" title="Delete track" onClick={() => removeTrack(track.id)}>
                    <PiTrash size={12} />
                  </button>
                ) : null}
              </div>
              <div
                className="timeline-track"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setPlayhead(((event.clientX - rect.left) / rect.width) * total);
                }}
              >
                <div className="timeline-head" style={{ left: `${(playhead / total) * 100}%` }} />
                {track.kind === "video"
                  ? track.clips.map((clip) => (
                      <div
                        key={clip.id}
                        className={"timeline-clip" + (selected === clip.id ? " selected" : "")}
                        style={{ left: `${(clip.start / total) * 100}%`, width: `${(clip.duration / total) * 100}%` }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected(clip.id);
                        }}
                        title={clip.name}
                      >
                        {clip.name}
                      </div>
                    ))
                  : track.clips.map((clip) => (
                      <div
                        key={clip.id}
                        className="timeline-audio"
                        style={{ left: `${(clip.start / total) * 100}%`, width: `${(clip.duration / total) * 100}%` }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected(clip.id);
                        }}
                        title={clip.name}
                      >
                        {clip.name}
                      </div>
                    ))}
                {track.kind === "video"
                  ? project.texts.map((text) => (
                      <div
                        key={text.id}
                        className={"timeline-text" + (selected === text.id ? " selected" : "")}
                        style={{ left: `${(text.start / total) * 100}%`, width: `${(text.duration / total) * 100}%` }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected(text.id);
                        }}
                      >
                        {text.text || "Caption"}
                      </div>
                    ))
                  : null}
              </div>
            </div>
          ))}
        </div>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
