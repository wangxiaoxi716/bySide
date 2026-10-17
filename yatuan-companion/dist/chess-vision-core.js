// Camera geometry and conservative physical-stone tracking. No camera, DOM, or network access.
export const VISION_BOARD_SIZE = 15;
const SIZE = VISION_BOARD_SIZE;
const LAST = SIZE - 1;
const EPSILON = 1e-8;
const isPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

function solve(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < vector.length; col++) {
    let pivot = col;
    for (let row = col + 1; row < rows.length; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }
    if (Math.abs(rows[pivot][col]) < EPSILON) throw new Error('棋盘标定退化，请重新选择四个角。');
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    for (let index = col; index <= vector.length; index++) rows[col][index] /= divisor;
    for (let row = 0; row < rows.length; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let index = col; index <= vector.length; index++) rows[row][index] -= factor * rows[col][index];
    }
  }
  return [...rows.map(row => row[vector.length]), 1];
}

function homography(from, to) {
  const matrix = [], vector = [];
  for (let index = 0; index < 4; index++) {
    const { x: u, y: v } = from[index], { x, y } = to[index];
    matrix.push([u, v, 1, 0, 0, 0, -x * u, -x * v]); vector.push(x);
    matrix.push([0, 0, 0, u, v, 1, -y * u, -y * v]); vector.push(y);
  }
  return solve(matrix, vector);
}

function transform(matrix, point) {
  const divisor = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (!Number.isFinite(divisor) || Math.abs(divisor) < EPSILON) return null;
  const mapped = {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / divisor,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / divisor,
  };
  return isPoint(mapped) ? mapped : null;
}

/** Corners are the outer INTERSECTIONS, in A1, O1, O15, A15 order, in camera pixels. */
export function calibrateBoard(corners, width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('摄像头画面尺寸无效。');
  }
  const input = Array.isArray(corners) ? corners : ['a1', 'o1', 'o15', 'a15'].map(key => corners?.[key]);
  if (input.length !== 4 || !input.every(isPoint)) throw new Error('请按 A1、O1、O15、A15 顺序选择四个交叉点。');
  const points = input.map(({ x, y }) => ({ x, y }));
  if (points.some(point => point.x < 0 || point.y < 0 || point.x > width || point.y > height)) {
    throw new Error('标定点必须位于摄像头画面内。');
  }
  const turns = points.map((point, index) => cross(point, points[(index + 1) % 4], points[(index + 2) % 4]));
  if (turns.some(turn => Math.abs(turn) < EPSILON) || !turns.every(turn => Math.sign(turn) === Math.sign(turns[0]))) {
    throw new Error('四个角不能交叉、重合或凹陷，请沿棋盘边缘依次选择。');
  }
  const area = Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % 4];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
  if (area < 64 || points.some((point, index) => distance(point, points[(index + 1) % 4]) < LAST)) {
    throw new Error('棋盘在画面中太小，请调整摄像头后重新标定。');
  }
  const grid = [{ x: 0, y: 0 }, { x: LAST, y: 0 }, { x: LAST, y: LAST }, { x: 0, y: LAST }];
  const matrix = homography(grid, points), inverse = homography(points, grid);
  const intersections = Array.from({ length: SIZE * SIZE }, (_, index) => {
    const row = Math.floor(index / SIZE), col = index % SIZE;
    const point = transform(matrix, { x: col, y: row });
    if (!point) throw new Error('透视标定无效，请重新选择四个角。');
    return { index, row, col, label: `${String.fromCharCode(65 + col)}${row + 1}`, ...point };
  });
  for (const point of intersections) {
    const neighbors = [[point.row - 1, point.col], [point.row + 1, point.col], [point.row, point.col - 1], [point.row, point.col + 1]]
      .filter(([row, col]) => row >= 0 && row < SIZE && col >= 0 && col < SIZE);
    point.spacing = Math.min(...neighbors.map(([row, col]) => distance(point, intersections[row * SIZE + col])));
    if (point.spacing < 1) throw new Error('部分交叉点过于密集，请调整摄像头角度。');
  }
  const signature = JSON.stringify([width, height, ...points.flatMap(point => [point.x, point.y])]);
  return { width, height, corners: points, matrix, inverse, intersections, signature };
}

/** Return continuous board coordinates; row/col 0..14 delimit the calibrated board. */
export function cameraPointToBoard(calibration, point) {
  if (!calibration?.inverse || !isPoint(point)) return null;
  const result = transform(calibration.inverse, point);
  return result ? { row: result.y, col: result.x } : null;
}

/** Match actual camera-pixel distance, rejecting outside points, distant centers, and ambiguity. */
export function nearestIntersection(calibration, point, { toleranceRatio = 0.42, ambiguityRatio = 0.8 } = {}) {
  if (!calibration?.intersections || !isPoint(point) || !(toleranceRatio > 0 && toleranceRatio < 0.5)
    || !(ambiguityRatio > 0 && ambiguityRatio < 1)) return null;
  const grid = cameraPointToBoard(calibration, point);
  if (!grid || grid.row < -EPSILON || grid.col < -EPSILON || grid.row > LAST + EPSILON || grid.col > LAST + EPSILON) return null;
  let first = null, secondDistance = Infinity;
  for (const intersection of calibration.intersections) {
    const delta = distance(point, intersection);
    if (!first || delta < first.distance) {
      secondDistance = first?.distance ?? Infinity;
      first = { ...intersection, distance: delta };
    } else if (delta < secondDistance) secondDistance = delta;
  }
  if (!first || first.distance > first.spacing * toleranceRatio || first.distance > secondDistance * ambiguityRatio) return null;
  return { ...first, gridPoint: grid };
}

const BLACK_LABELS = new Set(['black', 'black_stone', 'black-stone', '黑子']);
function detectionCenter(detection, minConfidence) {
  if (!detection || !BLACK_LABELS.has(String(detection.label ?? detection.color ?? '').toLowerCase())
    || !Number.isFinite(detection.confidence) || detection.confidence < minConfidence || detection.confidence > 1) return null;
  if (isPoint(detection.center)) return { ...detection.center };
  const bbox = detection.bbox;
  const [x, y, width, height] = Array.isArray(bbox) ? bbox : [bbox?.x, bbox?.y, bbox?.width, bbox?.height];
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x: x + width / 2, y: y + height / 2 };
}

/** Reference-image masks may identify one actually covered crossing. YOLO keeps center matching. */
export function matchStoneDetection(calibration, detection, { minConfidence = .6, ...options } = {}) {
  const center = detectionCenter(detection, minConfidence);
  if (!center || !calibration?.intersections) return null;
  const covered = detection.coveredIntersections;
  if (detection.method !== 'reference-image' || covered === undefined) {
    const match = nearestIntersection(calibration, center, options);
    return match ? { ...match, matchMethod: 'center' } : null;
  }
  if (!Array.isArray(covered) || covered.length > 1 || covered.some(index => !Number.isInteger(index) || index < 0 || index >= SIZE * SIZE)) return null;
  if (!Array.isArray(detection.coverageSamples) || detection.coverageSamples.length !== covered.length) return null;
  if (!covered.length) {
    const match = nearestIntersection(calibration, center, options);
    return match ? { ...match, matchMethod: 'center' } : null;
  }
  const point = calibration.intersections[covered[0]], sample = detection.coverageSamples[0];
  const bbox = detection.bbox;
  if (!point || !sample || sample.index !== point.index || !Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return null;
  const [x, y, width, height] = bbox;
  if (width < 2 || height < 2 || x < -1 || y < -1 || x + width > calibration.width + 1 || y + height > calibration.height + 1
    || center.x < x || center.x > x + width || center.y < y || center.y > y + height
    || point.x < x - .75 || point.x > x + width + .75 || point.y < y - .75 || point.y > y + height + .75) return null;
  const neighbors = [[point.row - 1, point.col], [point.row + 1, point.col], [point.row, point.col - 1], [point.row, point.col + 1]]
    .filter(([row, col]) => row >= 0 && row < SIZE && col >= 0 && col < SIZE);
  const spacing = Math.max(...neighbors.map(([row, col]) => distance(point, calibration.intersections[row * SIZE + col])));
  if (width > spacing * 1.75 || height > spacing * 1.75 || distance(center, point) > spacing * .85) return null;
  // These are pixels from the same connected foreground mask, not a bounding-box overlap claim.
  if (![sample.x, sample.y, sample.current, sample.expected].every(Number.isFinite)
    || Math.abs(sample.x - point.x) > .75 || Math.abs(sample.y - point.y) > .75
    || sample.current < 0 || sample.current > 255 || sample.expected < 0 || sample.expected > 255
    || sample.expected - sample.current < 8 || sample.current >= Math.max(55, sample.expected * .76)) return null;
  return { ...point, distance: distance(center, point), gridPoint: cameraPointToBoard(calibration, center), matchMethod: 'coverage' };
}

const validGame = game => game && Array.isArray(game.board) && game.board.length === SIZE * SIZE
  && game.board.every(cell => cell === 0 || cell === 1 || cell === 2) && [1, 2].includes(game.turn);

/**
 * Explicit arm -> clear baseline -> stable new stone -> accepted (once).
 * update({detections:[{label:'black',confidence:.9,bbox:[x,y,w,h]}],
 *   game, gameId, sourceSignature, now, enabled:true, demo:false, mode:'pet', transient:false})
 * Explicit transient:true may retain an existing candidate for at most two null/empty frames
 * within 1200ms of its last valid observation. It never counts as evidence or clean baseline.
 * Only status === 'accepted' authorizes an attempt to play result.index.
 * Revalidate that move in the authoritative game before publishing it.
 * arm/reset must be called after undo/restart even when no intervening frame observed the old board.
 */
export function createStoneTracker({ calibration = null, stableFrames = 3, stableMs = 700, maxFrameGapMs = 1200,
  minConfidence = 0.6, toleranceRatio = 0.42, ambiguityRatio = 0.8 } = {}) {
  if (!Number.isInteger(stableFrames) || stableFrames < 3 || !Number.isFinite(stableMs) || stableMs < 700
    || !Number.isFinite(maxFrameGapMs) || maxFrameGapMs <= 0 || !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1
    || !(toleranceRatio > 0 && toleranceRatio < 0.5) || !(ambiguityRatio > 0 && ambiguityRatio < 1)) {
    throw new Error('稳定检测至少需要 3 帧且持续 700 毫秒，检测参数必须有效。');
  }
  let armed = false, waitingBaseline = true, baseline = null, pending = null, previous = null, accepted = new Set();
  let latest = { status: 'disarmed', progress: 0, reason: '请先标定，再开启实物落子。' };
  const output = (status, reason, extra = {}) => {
    latest = { status, reason, progress: 0, ...extra };
    return latest;
  };
  const clear = () => { baseline = null; pending = null; previous = null; accepted = new Set(); waitingBaseline = true; };
  function disarm() {
    armed = false; clear();
    return output('disarmed', '检测已暂停，重新开启前请整理实体棋子。');
  }
  function arm() {
    clear();
    armed = Boolean(calibration);
    return output(armed ? 'baseline' : 'uncalibrated', armed ? '请先移除数字棋盘之外的实体黑子。' : '请先完成棋盘标定。');
  }
  function update(frame = {}) {
    const { detections, game, gameId = '', sourceSignature = '', enabled = true, demo = false, mode = 'pet' } = frame;
    const now = frame.now ?? Date.now();
    if (!calibration) { pending = null; return output('uncalibrated', '请先完成棋盘标定。'); }
    if (!armed) return output('disarmed', '检测已暂停，请重新开启实物落子。');
    if (!validGame(game) || !Number.isFinite(now)) {
      baseline = null; pending = null; return output('invalid-frame', '尚未获得有效画面或棋局，等待下一帧。');
    }
    if (previous && (gameId !== previous.gameId || sourceSignature !== previous.sourceSignature
      || previous.board.some((cell, index) => cell !== 0 && game.board[index] !== cell)
      || (Number.isInteger(game.moves?.length) && game.moves.length < previous.moveCount))) {
      disarm();
      return output('rearm-required', '棋局、摄像头或棋盘状态已改变，请整理实体棋子并重新开启。');
    }
    // A complete black/white turn may have occurred between camera frames.
    if (previous && previous.board.some((cell, index) => game.board[index] !== cell)) {
      baseline = null; pending = null;
    }
    previous = { gameId, sourceSignature, board: game.board.slice(), moveCount: game.moves?.length ?? 0 };
    if (!enabled || demo || mode !== 'pet' || game.turn !== 1 || game.winner || game.draw) {
      baseline = null; pending = null;
      return output('paused', game.winner || game.draw ? '本局已结束。' : demo ? '演示期间不接收实体落子。' : '等待你的回合。');
    }
    const transient = frame.transient === true && (detections === null || (Array.isArray(detections) && !detections.length));
    if (transient) {
      baseline = null;
      if (!waitingBaseline && pending) {
        if (now <= pending.lastSeenAt) {
          pending = null; return output('stale-frame', '等待新的摄像头画面。');
        }
        if (pending.misses < 2 && now - pending.lastAt <= Math.min(1200, maxFrameGapMs)) {
          pending.misses++; pending.lastSeenAt = now; pending.consecutive = 0;
          return output('transient', `正在继续确认 ${pending.candidate.label}，等待清晰画面。`, {
            candidate: pending.candidate, progress: pending.progress, frames: pending.frames,
            elapsed: pending.elapsed, missedFrames: pending.misses,
          });
        }
      }
      pending = null;
      return output('invalid-frame', '画面暂不清晰，等待重新确认实体黑子。');
    }
    if (!Array.isArray(detections)) {
      baseline = null; pending = null; return output('invalid-frame', '尚未获得有效画面或棋局，等待下一帧。');
    }
    const candidates = new Map();
    let rejected = 0;
    for (const detection of detections) {
      const center = detectionCenter(detection, minConfidence);
      if (!center) continue;
      const candidate = matchStoneDetection(calibration, detection, { minConfidence, toleranceRatio, ambiguityRatio });
      if (!candidate) {
        // Spare stones remain ignored, unless a reference mask explicitly claims board coverage.
        const grid = cameraPointToBoard(calibration, center);
        const claimsCoverage = detection.method === 'reference-image' && Array.isArray(detection.coveredIntersections) && detection.coveredIntersections.length > 0;
        if (!claimsCoverage && (!grid || grid.row < -EPSILON || grid.col < -EPSILON || grid.row > LAST + EPSILON || grid.col > LAST + EPSILON)) continue;
        rejected++; continue;
      }
      if (game.board[candidate.index] !== 0 || accepted.has(candidate.index)) continue;
      const existing = candidates.get(candidate.index);
      if (!existing || candidate.distance < existing.distance) candidates.set(candidate.index, { ...candidate, center });
    }
    if (waitingBaseline) {
      pending = null;
      if (candidates.size || rejected) {
        baseline = null;
        return output('clear-required', '请移除未记录的实体黑子，等待画面清空后再落子。', { count: candidates.size });
      }
      if (baseline && now <= baseline.lastAt) {
        baseline = null; return output('stale-frame', '等待新的摄像头画面。');
      }
      if (!baseline || now - baseline.lastAt > maxFrameGapMs) baseline = { firstAt: now, lastAt: now, frames: 1 };
      else { baseline.frames++; baseline.lastAt = now; }
      const elapsed = now - baseline.firstAt;
      if (baseline.frames < stableFrames || elapsed < stableMs) {
        return output('baseline', '正在确认棋盘已整理好，请暂时不要落子。', {
          progress: Math.min(1, baseline.frames / stableFrames, elapsed / stableMs), frames: baseline.frames, elapsed,
        });
      }
      waitingBaseline = false;
      baseline = null;
      return output('ready', '准备好了，请在交叉点上放一枚黑子。');
    }
    if (candidates.size > 1) {
      pending = null;
      return output('multiple', '同时发现多枚新黑子，请每次只放一枚。', { count: candidates.size });
    }
    // An unmatched black center may be a hand-held or displaced stone: wait instead of guessing.
    if (rejected) {
      pending = null;
      return output('unmatched', '黑子尚未稳定对准交叉点，请调整位置。', { count: rejected });
    }
    if (!candidates.size) { pending = null; return output('ready', '等待一枚新的实体黑子。'); }
    const candidate = candidates.values().next().value;
    if (pending && now <= pending.lastSeenAt) {
      pending = null; return output('stale-frame', '等待新的摄像头画面。');
    }
    const allowedGap = pending?.misses ? Math.min(1200, maxFrameGapMs) : maxFrameGapMs;
    if (!pending || pending.index !== candidate.index || now - pending.lastAt > allowedGap) {
      pending = { index: candidate.index, lastAt: now, lastSeenAt: now, frames: 1, elapsed: 0, consecutive: 1, misses: 0 };
    } else {
      // Missing/invalid frames retain evidence, but their time cannot advance confirmation.
      if (!pending.misses) pending.elapsed += now - pending.lastAt;
      pending.frames++; pending.consecutive++; pending.lastAt = now; pending.lastSeenAt = now; pending.misses = 0;
    }
    const elapsed = pending.elapsed;
    const progress = Math.min(1, pending.frames / stableFrames, elapsed / stableMs);
    pending.candidate = candidate; pending.progress = progress;
    if (pending.frames >= stableFrames && elapsed >= stableMs && pending.consecutive >= 2) {
      accepted.add(candidate.index); pending = null;
      return output('accepted', `识别到黑子 ${candidate.label}。`, { index: candidate.index, candidate, progress: 1 });
    }
    return output('stabilizing', `正在确认 ${candidate.label}，请稍等片刻。`, { candidate, progress, frames: pending.frames, elapsed });
  }
  return {
    arm, disarm, reset: disarm, update,
    setCalibration(next) { calibration = next; return disarm(); },
    getState() { return { ...latest, armed, waitingBaseline }; },
  };
}
