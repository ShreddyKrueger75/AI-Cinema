export type ImageModelId =
  | "pollinations"
  | "flux-1.1-pro"
  | "flux-schnell"
  | "sdxl"
  | "ideogram-v2";
export type MotionModelId =
  | "ken-burns"
  | "runway-gen4"
  | "runway-gen3"
  | "pika-2.0"
  | "kling-2.0"
  | "luma-dream-machine";

export type ImageModel = {
  id: ImageModelId;
  label: string;
  cost_per_image: number;
  free?: boolean;
};
export type MotionModel = {
  id: MotionModelId;
  label: string;
  cost_per_second: number;
  free?: boolean;
};

export const IMAGE_MODELS: ImageModel[] = [
  { id: "pollinations", label: "Pollinations (free)", cost_per_image: 0, free: true },
  { id: "flux-1.1-pro", label: "Flux 1.1 Pro", cost_per_image: 0.04 },
  { id: "flux-schnell", label: "Flux Schnell", cost_per_image: 0.003 },
  { id: "sdxl", label: "SDXL", cost_per_image: 0.003 },
  { id: "ideogram-v2", label: "Ideogram v2", cost_per_image: 0.08 },
];

export const MOTION_MODELS: MotionModel[] = [
  { id: "ken-burns", label: "Ken Burns (free)", cost_per_second: 0, free: true },
  { id: "runway-gen4", label: "Runway Gen-4", cost_per_second: 0.4 },
  { id: "runway-gen3", label: "Runway Gen-3", cost_per_second: 0.25 },
  { id: "pika-2.0", label: "Pika 2.0", cost_per_second: 0.2 },
  { id: "kling-2.0", label: "Kling 2.0", cost_per_second: 0.3 },
  { id: "luma-dream-machine", label: "Luma Dream Machine", cost_per_second: 0.35 },
];

export const DURATION_OPTIONS_S = [1, 2, 3, 4, 5];

export function imageModelLabel(id: string): string {
  return IMAGE_MODELS.find((m) => m.id === id)?.label ?? id;
}
export function motionModelLabel(id: string): string {
  return MOTION_MODELS.find((m) => m.id === id)?.label ?? id;
}
export function imageModelCost(id: string): number {
  return IMAGE_MODELS.find((m) => m.id === id)?.cost_per_image ?? 0;
}
export function motionModelCost(id: string, duration_s: number): number {
  const c = MOTION_MODELS.find((m) => m.id === id)?.cost_per_second ?? 0;
  return c * duration_s;
}
export function isImageModelFree(id: string): boolean {
  return IMAGE_MODELS.find((m) => m.id === id)?.free ?? false;
}
export function isMotionModelFree(id: string): boolean {
  return MOTION_MODELS.find((m) => m.id === id)?.free ?? false;
}
