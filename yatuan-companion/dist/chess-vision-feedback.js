// Only preserve an already observed stone. A clean startup frame must reach the baseline tracker.
export function isTransientStoneMiss(result, previous) {
  const candidate = previous?.candidate;
  if (!candidate || !['stabilizing', 'transient'].includes(previous.status)) return false;
  if (!result.blocked) return result.detections.length === 0;
  const rejections = result.diagnostics?.rejections || [];
  const preview = result.diagnostics?.previewDetections || [];
  // One covered edge pixel can flicker while the same stone stays physically still.
  // A second object, multiple crossings, hands, and exposure jumps must hard-reset.
  return candidate.matchMethod === 'coverage' && Boolean(candidate.center)
    && rejections.length === 1 && rejections[0].code === 'off-grid' && preview.length === 1
    && preview[0].coveredIntersections?.length === 0
    && Math.hypot(preview[0].center.x - candidate.center.x, preview[0].center.y - candidate.center.y) <= candidate.spacing * .1;
}
