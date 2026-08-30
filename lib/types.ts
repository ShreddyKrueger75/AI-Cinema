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
};

/**
 * Where the picture changed between two sampled frames — the centroid of the
 * changed pixels, which in a screen recording lands on the cursor and in film
 * footage lands on whatever moved. Ported from movie-digest's `pointer_of`.
 */
export type Pointer = {
  nx: number;
  ny: number;
  region: string;
  changed_fraction: number;
};

/** One detected shot: a keyframe plus where it sits in the source video. */
export type Shot = {
  id: string;
  /** Seconds into the source video. */
  start_s: number;
  duration_s: number;
  /** JPEG data URL of the keyframe. */
  thumbnail: string;
  /** Mean absolute grayscale delta from the previous kept frame. */
  change_score: number;
  pointer: Pointer | null;
};

export type DigestMode = "insano" | "strict" | "standard" | "lenient";

export type Digest = {
  source_name: string;
  duration_s: number;
  width: number;
  height: number;
  mode: DigestMode;
  sampled_frames: number;
  shots: Shot[];
};

/**
 * One storyboard card. `description` is the human-facing text; `image_prompt`
 * and `motion_prompt` are what a regenerate would actually send. They start
 * out identical to what the vision pass wrote and diverge once edited.
 */
export type StoryboardCard = {
  id: string;
  title: string;
  description: string;
  image_prompt: string;
  motion_prompt: string;
  duration_s: number;
  thumbnail: string;
  source_start_s: number;
  change_score: number;
  pointer: Pointer | null;
  /** True once a vision pass has written this card's text. */
  described: boolean;
};

/**
 * One grouped run of transcribed narration, on the same source-video clock
 * as the digest shots. Grouping happens in lib/transcribe.ts.
 */
export type TranscriptSegment = {
  id: string;
  text: string;
  start_s: number;
  duration_s: number;
};

export type Storyboard = {
  source_name: string;
  source_duration_s: number;
  mode: DigestMode;
  cards: StoryboardCard[];
  /** Narration transcript, once the listen pass has run. */
  transcript?: TranscriptSegment[];
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
  graphics: GraphicOverlay[];
  music_track?: MusicTrack;
  grade?: Grade;
  brief?: Brief;
  title_settings?: TitleStyle;
  created_at: string;
  updated_at: string;
};
