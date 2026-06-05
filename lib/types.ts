export type Aspect = "9:16" | "16:9" | "1:1";

export type Still = {
  id: string;
  label: string;
  image_prompt: string;
  model: string;
  input_ref: string | null;
  output_url?: string;
};

export type ClipMotion = {
  prompt: string;
  model: string;
  duration_s: number;
};

export type ClipVersion = {
  id: string;
  kind: "clip";
  label: string;
  still_ref: string | null;
  motion: ClipMotion;
  output_url?: string;
};

export type TitleVersion = {
  id: string;
  kind: "title";
  label: string;
  text: string;
  style_ref: string | null;
  output_url?: string;
};

export type Version = ClipVersion | TitleVersion;

export type Section = {
  id: string;
  index: number;
  type: "clip" | "title";
  title: string;
  duration_s: number;
  notes?: string;
  versions: Version[];
  active_version_id: string | null;
  stills: Still[];
  active_still_id: string | null;
};

export type TransitionType = "cut" | "crossfade" | "fade_black";

export type Transition = {
  id: string;
  from_section_id: string;
  to_section_id: string;
  type: TransitionType;
  duration_s: number;
};

export type VOSegment = {
  id: string;
  text: string;
  voice: string;
  start_s: number;
  duration_s: number;
  output_url?: string;
};

export type MusicTrack = {
  id: string;
  name: string;
  prompt: string;
  model: string;
  output_url?: string;
  start_s?: number;
  duration_s?: number;
};

export type MusicSegment = {
  id: string;
  name: string;
  prompt: string;
  model: string;
  start_s: number;
  duration_s: number;
  output_url?: string;
};

export type Grade = {
  id: string;
  name: string;
  adjustments: Record<string, number | string>;
  thumbnail?: string;
};

export type Brief = {
  id: string;
  name: string;
  visual: string;
  lighting?: string;
  camera?: string;
  palette?: string;
  subject?: string;
  avoid?: string;
  refs?: string[];
};

export type TitleStyle = {
  id: string;
  name: string;
  font: string;
  color: string;
  background_color: string;
};

export type GraphicOverlay = {
  id: string;
  label: string;
  text: string;
  start_s: number;
  duration_s: number;
  style_ref?: string | null;
  font?: string;
  color?: string;
  background_color?: string;
  position?: "top" | "center" | "bottom";
  image_url?: string;
};

export type Project = {
  schema_version: 1;
  id: string;
  name: string;
  aspect: Aspect;
  duration_s: number;
  status: "draft" | "rendered";
  revision: number;
  sections: Section[];
  transitions: Transition[];
  vo_segments: VOSegment[];
  music_segments?: MusicSegment[];
  graphics: GraphicOverlay[];
  music_track?: MusicTrack;
  grade?: Grade;
  brief?: Brief;
  title_settings?: TitleStyle;
  created_at: string;
  updated_at: string;
};
