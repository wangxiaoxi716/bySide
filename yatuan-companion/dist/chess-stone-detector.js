// Model-free reference-image detector. This is NOT YOLO.
// Detect compact dark objects first; only then associate their measured centers with the board.
import { cameraPointToBoard, matchStoneDetection } from './chess-vision-core.js';

const luminance = (frame, x, y) => {
  const index = (y * frame.width + x) * 4;
  return frame.data[index] * .2126 + frame.data[index + 1] * .7152 + frame.data[index + 2] * .0722;
};
const project = (matrix, col, row) => {
  const z = matrix[6] * col + matrix[7] * row + matrix[8];
  return { x: (matrix[0] * col + matrix[1] * row + matrix[2]) / z, y: (matrix[3] * col + matrix[4] * row + matrix[5]) / z };
};
const round = value => Math.round(value * 1000) / 1000;
const withinBoard = point => point && point.col >= -1e-8 && point.row >= -1e-8 && point.col <= 14 + 1e-8 && point.row <= 14 + 1e-8;

function refineNativeCenter(frame, reference, bounds, exposureShift, darkening, padding) {
  let sum = 0, weightedX = 0, weightedY = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = Math.max(0, bounds.minY - padding); y <= Math.min(frame.height - 1, bounds.maxY + padding); y++) {
    for (let x = Math.max(0, bounds.minX - padding); x <= Math.min(frame.width - 1, bounds.maxX + padding); x++) {
      const expected = Math.max(0, Math.min(255, luminance(reference, x, y) - exposureShift));
      const current = luminance(frame, x, y), weight = expected - current;
      if (weight < darkening || current >= Math.max(55, expected * .76)) continue;
      sum += weight; weightedX += x * weight; weightedY += y * weight;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return sum ? { center: { x: weightedX / sum, y: weightedY / sum }, bounds: { minX, minY, maxX, maxY } } : null;
}

export function detectReferenceStones(frame, reference, calibration, { board = Array(225).fill(0), darkening = 23 } = {}) {
  if (!frame?.data || !reference?.data || !calibration?.matrix || frame.width !== reference.width || frame.height !== reference.height
    || frame.width !== calibration.width || frame.height !== calibration.height
    || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width <= 0 || frame.height <= 0
    || frame.data.length !== frame.width * frame.height * 4 || reference.data.length !== frame.data.length) {
    throw new Error('画面或空棋盘参照尺寸不一致，请重新标定并记录空棋盘。');
  }
  if (!Array.isArray(board) || board.length !== 225 || board.some(value => ![0, 1, 2].includes(value))
    || !Number.isFinite(darkening) || darkening < 8 || darkening > 80) throw new Error('黑子辅助识别参数无效。');

  // Rectification makes a stone's shape independent of its offset from a grid crossing.
  // Keep the sample density bounded and close to actual camera resolution.
  const spacing = calibration.intersections.map(point => point.spacing).sort((a, b) => a - b)[112];
  const density = Math.max(10, Math.min(24, Math.round(spacing)));
  const margin = Math.ceil(.65 * density);
  const side = 14 * density + margin * 2 + 1, length = side * side;
  const before = new Float32Array(length), current = new Float32Array(length);
  const pixelsX = new Int32Array(length), pixelsY = new Int32Array(length);
  const mask = new Uint8Array(length), componentLabels = new Int32Array(length), exposureSamples = [];
  for (let row = 0; row < side; row++) for (let col = 0; col < side; col++) {
    const index = row * side + col;
    const p = project(calibration.matrix, (col - margin) / density, (row - margin) / density);
    const x = Math.round(p.x), y = Math.round(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
      throw new Error('棋盘太贴近画面边缘，请让四周至少留出约 0.7 格空白后重新标定。');
    }
    pixelsX[index] = x; pixelsY[index] = y;
    before[index] = luminance(reference, x, y); current[index] = luminance(frame, x, y);
    // A median resists a few stones, and avoids mistaking moderate camera auto-exposure for a hand.
    if (row >= margin && row <= side - margin - 1 && col >= margin && col <= side - margin - 1 && row % 3 === 0 && col % 3 === 0) {
      exposureSamples.push(before[index] - current[index]);
    }
  }
  exposureSamples.sort((a, b) => a - b);
  const exposureShift = exposureSamples[Math.floor(exposureSamples.length / 2)] || 0;
  const diagnostics = { exposureShift: round(exposureShift), sampleDensity: density, components: 0, ignoredOccupied: 0, ignoredNoise: 0, softNoise: [], candidates: [], rejections: [], previewDetections: [] };
  if (Math.abs(exposureShift) > 55) {
    diagnostics.rejections.push({ code: 'exposure', reason: '画面整体亮度变化太大，请保持光线稳定并重新记录空棋盘。' });
    return { detections: [], blocked: true, reason: diagnostics.rejections[0].reason, diagnostics };
  }
  for (let index = 0; index < length; index++) {
    const expected = Math.max(0, Math.min(255, before[index] - exposureShift));
    if (expected - current[index] >= darkening && current[index] < Math.max(55, expected * .76)) mask[index] = 1;
  }

  const detections = [], queue = new Int32Array(length);
  for (let seed = 0; seed < length; seed++) {
    if (mask[seed] !== 1) continue;
    diagnostics.components++;
    let head = 0, tail = 1; queue[0] = seed; mask[seed] = 2; componentLabels[seed] = diagnostics.components;
    let minCol = side, maxCol = 0, minRow = side, maxRow = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let weightSum = 0, weightedX = 0, weightedY = 0, currentSum = 0, expectedSum = 0, inBoard = 0;
    while (head < tail) {
      const index = queue[head++], row = Math.floor(index / side), col = index % side;
      const expected = Math.max(0, Math.min(255, before[index] - exposureShift)), weight = expected - current[index];
      minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
      minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
      minX = Math.min(minX, pixelsX[index]); maxX = Math.max(maxX, pixelsX[index]);
      minY = Math.min(minY, pixelsY[index]); maxY = Math.max(maxY, pixelsY[index]);
      weightSum += weight; weightedX += pixelsX[index] * weight; weightedY += pixelsY[index] * weight;
      currentSum += current[index]; expectedSum += expected;
      if (row >= margin && row <= side - margin - 1 && col >= margin && col <= side - margin - 1) inBoard++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || row + dy < 0 || row + dy >= side || col + dx < 0 || col + dx >= side) continue;
        const neighbor = (row + dy) * side + col + dx;
        if (mask[neighbor] === 1) { mask[neighbor] = 2; componentLabels[neighbor] = diagnostics.components; queue[tail++] = neighbor; }
      }
    }
    const widthCells = (maxCol - minCol + 1) / density, heightCells = (maxRow - minRow + 1) / density;
    const fill = tail / ((maxCol - minCol + 1) * (maxRow - minRow + 1));
    let center = { x: weightedX / weightSum, y: weightedY / weightSum };
    if (widthCells <= 1.5 && heightCells <= 1.5) {
      // Use native pixels for the final coordinate, avoiding resampling bias at outer intersections.
      const refined = refineNativeCenter(frame, reference, { minX, minY, maxX, maxY }, exposureShift, darkening, Math.ceil(spacing / density) + 1);
      if (refined) { center = refined.center; ({ minX, minY, maxX, maxY } = refined.bounds); }
    }
    // Camera pixels do not justify arbitrary floating precision; 0.1 px also removes
    // tiny asymmetric raster-edge errors for stones centered on an outer crossing.
    center = { x: Math.round(center.x * 10) / 10, y: Math.round(center.y * 10) / 10 };
    const gridCenter = cameraPointToBoard(calibration, center);
    const aspect = Math.min(widthCells, heightCells) / Math.max(widthCells, heightCells);
    const meanCurrent = currentSum / tail, meanExpected = expectedSum / tail;
    const padding = Math.max(1, spacing * .04);
    const bbox = [minX - padding, minY - padding, maxX - minX + padding * 2, maxY - minY + padding * 2];
    const coveredIntersections = [], coverageSamples = [];
    for (const point of calibration.intersections) {
      const index = (margin + point.row * density) * side + margin + point.col * density;
      if (componentLabels[index] !== diagnostics.components) continue;
      coveredIntersections.push(point.index);
      coverageSamples.push({ index: point.index, x: pixelsX[index], y: pixelsY[index], current: current[index], expected: Math.max(0, Math.min(255, before[index] - exposureShift)) });
    }
    const evidence = { coveredIntersections, coverageSamples };
    const match = matchStoneDetection(calibration, { label: 'black', confidence: .9, method: 'reference-image', center, bbox, ...evidence });
    const details = { center, bbox, widthCells: round(widthCells), heightCells: round(heightCells), fill: round(fill), contrast: round(meanExpected - meanCurrent), nearest: match?.label || null, coveredIntersections };

    if (tail < Math.max(5, density * density * .025)) { diagnostics.ignoredNoise++; continue; }
    if (!coveredIntersections.length && !withinBoard(gridCenter) && Math.max(widthCells, heightCells) < 1.3) continue; // Spare stones outside the grid.
    if (!inBoard) continue;
    const strongDarkness = meanCurrent < Math.max(55, meanExpected * .5);
    const clipped = minCol === 0 || minRow === 0 || maxCol === side - 1 || maxRow === side - 1;
    // A few weak projector/exposure speckles elsewhere must not veto a clearly visible stone.
    // Limit both the individual and total changed area; dark objects and broad shadows still block.
    const areaCells = tail / (density * density);
    if (!clipped && !strongDarkness && Math.max(widthCells, heightCells) <= .65 && areaCells <= .08) {
      diagnostics.softNoise.push({ ...details, areaCells });
      continue;
    }
    // An old physical stone and its projected counterpart may form one slightly wider footprint.
    if (match && board[match.index] && strongDarkness && !clipped && widthCells <= 1.5 && heightCells <= 1.5 && fill >= .45 && aspect >= .5) {
      diagnostics.ignoredOccupied++; continue;
    }
    const sufficientlyVisible = maxX - minX + 1 >= 4 && maxY - minY + 1 >= 4 && Math.min(widthCells, heightCells) >= .25;
    const roundStone = widthCells <= 1.04 && heightCells <= 1.04 && aspect >= .65 && fill >= .55 && fill <= .90;
    const squareToken = widthCells >= .55 && heightCells >= .55 && widthCells <= 1.15 && heightCells <= 1.15
      && aspect >= .72 && fill >= .82 && meanCurrent < Math.max(55, meanExpected * .42);
    let rejection = null;
    if (clipped) rejection = { code: 'clipped', reason: '暗物体越过识别画面边缘，请移开手并完整拍到棋盘。' };
    else if (!strongDarkness) rejection = { code: 'low-contrast', reason: '发现阴影或对比度不足的暗区，请移开手并保持光线稳定。' };
    else if (!sufficientlyVisible || (!roundStone && !squareToken)) rejection = { code: 'ambiguous-shape', reason: '暗区的大小或形状不像单枚棋子，请移开手或分开棋子。' };
    else if (coveredIntersections.length > 1) rejection = { code: 'multiple-covered', reason: '这枚黑子同时覆盖多个交叉点，请只覆盖一个交叉点。' };
    else if (!match) rejection = { code: 'off-grid', reason: '已看到黑子，请让黑子覆盖一个交叉点，或稍微靠近交叉点。' };
    const confidence = Math.min(.95, .72 + Math.min(.18, (meanExpected - meanCurrent) / 600) + Math.min(.05, fill / 20));
    if (diagnostics.previewDetections.length < 12) diagnostics.previewDetections.push({ label: 'black', confidence, center, bbox,
      method: 'reference-image', ...evidence, rejected: Boolean(rejection), reason: rejection?.reason || '黑子候选已匹配 ' + match.label });
    if (rejection) { diagnostics.rejections.push({ ...details, ...rejection }); continue; }

    const detection = { label: 'black', confidence, center, bbox, method: 'reference-image', ...evidence, shape: squareToken ? 'compact-square' : 'round' };
    detections.push(detection);
    diagnostics.candidates.push({ ...details, label: match.label, index: match.index });
  }
  if (diagnostics.softNoise.length > 3 || diagnostics.softNoise.reduce((sum, item) => sum + item.areaCells, 0) > .12) {
    diagnostics.rejections.push({ code: 'background-noise', reason: '棋盘背景多处在变化，请保持摄像头和光线稳定。' });
  }
  if (diagnostics.rejections.length || detections.length > 4) {
    return { detections: [], blocked: true, reason: diagnostics.rejections[0]?.reason || '同时发现太多新黑子，请每次只放一枚。', diagnostics };
  }
  return { detections, blocked: false, reason: '辅助识别依据空棋盘与当前画面的局部差异，不是 YOLO 检测。', diagnostics };
}
