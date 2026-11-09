export type PagePreset = {
  id: string;
  label: string;
  group: string;
  width: number;
  height: number;
};

export const PAGE_PRESETS: PagePreset[] = [
  { id: "linkedin-post", label: "LinkedIn Post", group: "Social", width: 1080, height: 1080 },
  { id: "linkedin-carousel", label: "LinkedIn Carousel", group: "Social", width: 1080, height: 1350 },
  { id: "instagram-post", label: "Instagram Post", group: "Social", width: 1080, height: 1080 },
  { id: "instagram-story", label: "Instagram Story", group: "Social", width: 1080, height: 1920 },
  { id: "x-post", label: "X Post", group: "Social", width: 1600, height: 900 },
  { id: "youtube-thumb", label: "YouTube Thumbnail", group: "Social", width: 1280, height: 720 },
  { id: "a4-portrait", label: "A4 Portrait", group: "Print", width: 794, height: 1123 },
  { id: "a4-landscape", label: "A4 Landscape", group: "Print", width: 1123, height: 794 },
  { id: "letter-portrait", label: "US Letter", group: "Print", width: 816, height: 1056 },
  { id: "slide-16x9", label: "Presentation 16:9", group: "Presentation", width: 1920, height: 1080 },
  { id: "slide-4x3", label: "Presentation 4:3", group: "Presentation", width: 1440, height: 1080 },
  { id: "video-1080p", label: "Video 1080p", group: "Video", width: 1920, height: 1080 },
  { id: "video-vertical", label: "Video Vertical", group: "Video", width: 1080, height: 1920 },
  { id: "custom", label: "Custom", group: "Custom", width: 1080, height: 1080 },
];

export function presetById(id: string): PagePreset | undefined {
  return PAGE_PRESETS.find((preset) => preset.id === id);
}

export function presetGroups(): string[] {
  const groups: string[] = [];
  for (const preset of PAGE_PRESETS) {
    if (!groups.includes(preset.group)) groups.push(preset.group);
  }
  return groups;
}

/** Human readable dimensions, e.g. "1080 × 1080 px". */
export function dimensionLabel(width: number, height: number): string {
  return `${width} × ${height} px`;
}
