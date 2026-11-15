export type CameraPreference = { id: string; label: string };
type Camera = { deviceId: string; label: string };
export type ZoomRange = { min: number; max: number; step: number; value: number };

type ZoomCapability = { min: number; max: number; step?: number };

export function findSavedCamera<T extends Camera>(cameras: T[], saved: CameraPreference): T | null {
  const exact = cameras.find(camera => camera.deviceId === saved.id);
  if (exact) return exact;
  const sameLabel = saved.label ? cameras.filter(camera => camera.label === saved.label) : [];
  return sameLabel.length === 1 ? sameLabel[0] : null;
}

export function zoomRange(track: MediaStreamTrack): ZoomRange | null {
  const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { zoom?: ZoomCapability }) | undefined;
  const zoom = caps?.zoom;
  if (!zoom || !Number.isFinite(zoom.min) || !Number.isFinite(zoom.max) || zoom.max <= zoom.min) return null;
  const current = (track.getSettings?.() as MediaTrackSettings & {zoom?: number})?.zoom;
  return {min: zoom.min, max: zoom.max, step: zoom.step && zoom.step > 0 ? zoom.step : 0.01, value: typeof current === 'number' && Number.isFinite(current) ? current : zoom.min};
}

export async function setTrackZoom(track: MediaStreamTrack, value: number): Promise<void> {
  await track.applyConstraints({advanced: [{zoom: value} as MediaTrackConstraintSet]});
}
