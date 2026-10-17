// Coordinates are CSS pixels in the projection window, never camera pixels.
const SIZE = 15;
const VIEWBOX = 480;
const INSET = 16;
const STEP = 32;
const round = value => Math.round(value * 100) / 100;
const label = index => `${String.fromCharCode(65 + index % SIZE)}${Math.floor(index / SIZE) + 1}`;

export function projectionGeometry(rect, width, height) {
  if (![rect?.left, rect?.top, rect?.width, rect?.height, width, height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0) return null;
  const intersections = Array.from({ length: SIZE * SIZE }, (_, index) => ({
    index,
    label: label(index),
    x: round(rect.left + (INSET + index % SIZE * STEP) / VIEWBOX * rect.width),
    y: round(rect.top + (INSET + Math.floor(index / SIZE) * STEP) / VIEWBOX * rect.height),
  }));
  return {
    width: round(width), height: round(height),
    corners: [0, 14, 224, 210].map(index => ({ ...intersections[index] })),
    intersections,
    signature: [width, height, rect.left, rect.top, rect.width, rect.height].map(round).join(':'),
  };
}

export function isProjectionGeometry(value) {
  if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width <= 0 || value.height <= 0 || value.width > 32768 || value.height > 32768 || typeof value.signature !== 'string' || value.signature.length > 150) return false;
  if (!Array.isArray(value.intersections) || value.intersections.length !== SIZE * SIZE || !Array.isArray(value.corners) || value.corners.length !== 4) return false;
  const validPoint = (point, index) => point?.index === index && point.label === label(index) && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= value.width && point.y >= 0 && point.y <= value.height;
  return value.intersections.every(validPoint) && [0, 14, 224, 210].every((index, position) => validPoint(value.corners[position], index) && value.corners[position].x === value.intersections[index].x && value.corners[position].y === value.intersections[index].y);
}

// Only the selected projection may change camera geometry. Passive mirrors can
// resize or close freely; an explicit claim is needed to switch after binding.
export function updateProjectionBinding(binding, command) {
  const id = command?.projectionId;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return binding;
  if (command.type === 'projection-release') {
    return id === binding.activeProjectionId ? { initialized: true, activeProjectionId: null, geometry: null } : binding;
  }
  if (command.type !== 'projection-geometry' && command.type !== 'projection-claim') return binding;
  const geometry = command.geometry;
  if (geometry !== null && !isProjectionGeometry(geometry)) return binding;
  if (command.type === 'projection-claim') {
    if (!geometry) return binding;
  } else if (id !== binding.activeProjectionId && (binding.initialized || !geometry)) return binding;
  if (id === binding.activeProjectionId && (geometry?.signature || null) === (binding.geometry?.signature || null)) return binding;
  return { initialized: true, activeProjectionId: id, geometry };
}
