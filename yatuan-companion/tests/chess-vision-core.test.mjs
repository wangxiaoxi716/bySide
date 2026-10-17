import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrateBoard, cameraPointToBoard, nearestIntersection, matchStoneDetection, createStoneTracker } from '../dist/chess-vision-core.js';
import { createGame, playMove, undoRound } from '../dist/chess-core.js';

const corners = [{ x: 100, y: 80 }, { x: 800, y: 80 }, { x: 800, y: 780 }, { x: 100, y: 780 }];
const calibration = calibrateBoard(corners, 1000, 900);
const stone = (index, extra = {}) => {
  const point = calibration.intersections[index];
  return { label: 'black', confidence: 0.95, bbox: [point.x - 15, point.y - 15, 30, 30], ...extra };
};
const frame = (now, detections = [], game = createGame(), extra = {}) => ({
  now, detections, game, gameId: 'game-1', sourceSignature: 'camera-1:1000x900', ...extra,
});
function ready(options = {}, game = createGame()) {
  const tracker = createStoneTracker({ calibration, ...options });
  tracker.arm();
  assert.equal(tracker.update(frame(0, [], game)).status, 'baseline');
  assert.equal(tracker.update(frame(350, [], game)).status, 'baseline');
  assert.equal(tracker.update(frame(700, [], game)).status, 'ready');
  return tracker;
}
function stable(tracker, index = 112, game = createGame(), start = 800) {
  tracker.update(frame(start, [stone(index)], game));
  tracker.update(frame(start + 350, [stone(index)], game));
  return tracker.update(frame(start + 700, [stone(index)], game));
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('calibration enumerates all 225 labeled intersections and the four actual grid corners', () => {
  assert.equal(calibration.intersections.length, 225);
  for (const [index, label, point] of [[0, 'A1', corners[0]], [14, 'O1', corners[1]], [224, 'O15', corners[2]], [210, 'A15', corners[3]]]) {
    const result = calibration.intersections[index];
    assert.equal(result.label, label);
    near(result.x, point.x); near(result.y, point.y);
  }
  const middle = calibration.intersections[112];
  assert.equal(middle.label, 'H8'); near(middle.x, 450); near(middle.y, 430); near(middle.spacing, 50);
  const named = calibrateBoard({ a1: corners[0], o1: corners[1], o15: corners[2], a15: corners[3] }, 1000, 900);
  assert.equal(named.signature, calibration.signature);
});

test('homography recovers an oblique board, rather than using bilinear interpolation', () => {
  const project = (col, row) => ({ x: (40 * col + 7 * row + 150) / (0.025 * col + 0.012 * row + 1),
    y: (3 * col + 42 * row + 80) / (0.025 * col + 0.012 * row + 1) });
  const tilted = calibrateBoard([project(0, 0), project(14, 0), project(14, 14), project(0, 14)], 1000, 900);
  for (const point of tilted.intersections) {
    const expected = project(point.col, point.row);
    near(point.x, expected.x); near(point.y, expected.y);
    const recovered = cameraPointToBoard(tilted, expected);
    near(recovered.col, point.col); near(recovered.row, point.row);
    assert.equal(nearestIntersection(tilted, expected).index, point.index);
  }
});

test('clockwise and mirrored corner order work when labels match the actual board', () => {
  const mirrored = calibrateBoard([corners[1], corners[0], corners[3], corners[2]], 1000, 900);
  near(mirrored.intersections[0].x, 800);
  near(mirrored.intersections[14].x, 100);
  assert.equal(nearestIntersection(mirrored, { x: 750, y: 130 }).label, 'B2');
});

test('calibration rejects missing, nonfinite, repeated, crossing, concave, and out-of-frame corners', () => {
  for (const points of [[], corners.slice(0, 3), [corners[0], corners[2], corners[1], corners[3]],
    [corners[0], corners[0], corners[2], corners[3]],
    [corners[0], corners[1], { x: 400, y: 200 }, corners[3]],
    [{ x: NaN, y: 80 }, ...corners.slice(1)], [{ x: -1, y: 80 }, ...corners.slice(1)],
    [corners[0], { x: 1001, y: 80 }, ...corners.slice(2)],
    [{ x: 100, y: 100 }, { x: 101, y: 100 }, { x: 101, y: 101 }, { x: 100, y: 101 }]]) {
    assert.throws(() => calibrateBoard(points, 1000, 900));
  }
  for (const size of [0, -1, NaN, Infinity, '1000']) assert.throws(() => calibrateBoard(corners, size, 900));
});

test('matching accepts jitter near a grid point but rejects between-point ambiguity and outside the board', () => {
  assert.equal(nearestIntersection(calibration, { x: 456, y: 424 }).index, 112);
  assert.equal(nearestIntersection(calibration, { x: 475, y: 430 }), null);
  assert.equal(nearestIntersection(calibration, { x: 473, y: 430 }), null);
  assert.equal(nearestIntersection(calibration, { x: 99.999, y: 80 }), null);
  assert.equal(nearestIntersection(calibration, { x: 801, y: 400 }), null);
  assert.equal(nearestIntersection(calibration, { x: Infinity, y: 400 }), null);
  assert.equal(nearestIntersection(calibration, { x: 100, y: 80 }).index, 0);
  // Stricter ambiguity rejection is independent of the ordinary distance tolerance.
  assert.equal(nearestIntersection(calibration, { x: 470, y: 430 }, { ambiguityRatio: 0.5 }), null);
});

test('outside rejection follows the perspective quadrilateral, not its bounding rectangle', () => {
  const tilted = calibrateBoard([{ x: 300, y: 100 }, { x: 700, y: 100 }, { x: 900, y: 800 }, { x: 100, y: 800 }], 1000, 900);
  assert.equal(nearestIntersection(tilted, { x: 110, y: 110 }), null);
  assert.ok(cameraPointToBoard(tilted, { x: 110, y: 110 }).col < 0);
});

test('tracker starts disarmed and cannot arm without a valid calibration', () => {
  const empty = createStoneTracker();
  assert.equal(empty.arm().status, 'uncalibrated');
  assert.equal(empty.update(frame(0)).status, 'uncalibrated');
  const tracker = createStoneTracker({ calibration });
  assert.equal(tracker.update(frame(0)).status, 'disarmed');
  for (const options of [{ stableFrames: 2 }, { stableMs: 699 }, { maxFrameGapMs: 0 }, { minConfidence: -1 }, { toleranceRatio: 0.5 }]) {
    assert.throws(() => createStoneTracker({ calibration, ...options }));
  }
});

test('arming requires a clean baseline for at least three frames AND 700ms', () => {
  const tracker = createStoneTracker({ calibration }); tracker.arm();
  assert.equal(tracker.update(frame(0, [stone(112)])).status, 'clear-required');
  assert.equal(tracker.update(frame(100)).status, 'baseline');
  assert.equal(tracker.update(frame(450)).status, 'baseline');
  assert.equal(tracker.update(frame(500)).status, 'baseline');
  assert.equal(tracker.update(frame(800)).status, 'ready');
});

test('one obscured or empty frame cannot bypass old physical stones during rearming', () => {
  const tracker = createStoneTracker({ calibration }); tracker.arm();
  tracker.update(frame(0, [stone(112)]));
  tracker.update(frame(350));
  assert.equal(tracker.update(frame(700, [stone(112)])).status, 'clear-required');
  assert.equal(tracker.update(frame(1050)).status, 'baseline');
  assert.equal(tracker.update(frame(1400)).status, 'baseline');
  assert.equal(tracker.update(frame(1750)).status, 'ready');
});

test('stable physical black stone is accepted exactly once, even before the game acknowledges it', () => {
  const tracker = ready();
  const result = stable(tracker);
  assert.equal(result.status, 'accepted'); assert.equal(result.index, 112); assert.equal(result.candidate.label, 'H8');
  assert.equal(result.progress, 1);
  assert.equal(stable(tracker, 112, createGame(), 1600).status, 'ready');
});

test('three very fast frames are insufficient and two slow frames are insufficient', () => {
  const tracker = ready();
  tracker.update(frame(800, [stone(112)]));
  tracker.update(frame(810, [stone(112)]));
  assert.equal(tracker.update(frame(820, [stone(112)])).status, 'stabilizing');
  assert.equal(tracker.update(frame(1500, [stone(112)])).status, 'accepted');
  const second = ready();
  second.update(frame(800, [stone(112)]));
  assert.equal(second.update(frame(1500, [stone(112)])).status, 'stabilizing');
});

test('small center jitter keeps one stable candidate', () => {
  const tracker = ready();
  tracker.update(frame(800, [stone(112, { center: { x: 448, y: 433 } })]));
  tracker.update(frame(1150, [stone(112, { center: { x: 453, y: 428 } })]));
  assert.equal(tracker.update(frame(1500, [stone(112, { center: { x: 450, y: 431 } })])).status, 'accepted');
});

test('changed candidate, empty frame, invalid frame, and long frame gap reset stability', () => {
  for (const interrupt of [frame(1000), frame(1000, null), frame(1000, [stone(113)]), frame(2400, [stone(112)])]) {
    const tracker = ready();
    tracker.update(frame(800, [stone(112)]));
    tracker.update(interrupt);
    const nextAt = interrupt.now + 100;
    assert.equal(tracker.update(frame(nextAt, [stone(112)])).status, 'stabilizing');
    assert.equal(tracker.update(frame(nextAt + 100, [stone(112)])).status, 'stabilizing');
  }
});

test('two explicitly transient misses retain the candidate and only valid observations advance confirmation', () => {
  const tracker = ready();
  tracker.update(frame(800, [stone(112)]));
  const before = tracker.update(frame(1150, [stone(112)]));
  for (const [now, detections, misses] of [[1250, null, 1], [1400, [], 2]]) {
    const result = tracker.update(frame(now, detections, createGame(), { transient: true }));
    assert.equal(result.status, 'transient');
    assert.equal(result.candidate.index, 112);
    assert.equal(result.frames, before.frames);
    assert.equal(result.elapsed, before.elapsed);
    assert.equal(result.progress, before.progress);
    assert.equal(result.missedFrames, misses);
    assert.equal(result.index, undefined);
  }
  const restored = tracker.update(frame(1600, [stone(112)]));
  assert.equal(restored.status, 'stabilizing');
  assert.equal(restored.frames, 3);
  assert.equal(restored.elapsed, 350); // The 450ms gap was not evidence of a stationary stone.
  assert.equal(tracker.update(frame(1950, [stone(112)])).status, 'accepted');
});

test('recovery needs two consecutive valid frames even if earlier evidence already spans 700ms', () => {
  const tracker = ready();
  tracker.update(frame(800, [stone(112)]));
  assert.equal(tracker.update(frame(1500, [stone(112)])).elapsed, 700);
  assert.equal(tracker.update(frame(1600, null, createGame(), { transient: true })).status, 'transient');
  const restored = tracker.update(frame(1700, [stone(112)]));
  assert.equal(restored.status, 'stabilizing');
  assert.equal(restored.frames, 3);
  assert.equal(restored.elapsed, 700);
  assert.equal(tracker.update(frame(1750, [stone(112)])).status, 'accepted');
});

test('interleaved misses cannot turn three scattered observations into a confirmed stone', () => {
  const tracker = ready();
  tracker.update(frame(800, [stone(112)]));
  for (const now of [1000, 1500, 2000, 2500]) {
    assert.equal(tracker.update(frame(now, null, createGame(), { transient: true })).status, 'transient');
    const result = tracker.update(frame(now + 300, [stone(112)]));
    assert.equal(result.status, 'stabilizing');
    assert.equal(result.elapsed, 0);
    assert.equal(result.progress, 0);
  }
  tracker.update(frame(3150, [stone(112)]));
  assert.equal(tracker.update(frame(3500, [stone(112)])).status, 'accepted');
});

test('three consecutive misses or a recovery gap over 1200ms discard old evidence', () => {
  for (const interruptions of [
    [[1200, null], [1300, []], [1400, null]],
    [[2351, null]],
  ]) {
    const tracker = ready({ maxFrameGapMs: 3500 });
    tracker.update(frame(800, [stone(112)]));
    tracker.update(frame(1150, [stone(112)]));
    let result;
    for (const [now, detections] of interruptions) result = tracker.update(frame(now, detections, createGame(), { transient: true }));
    assert.equal(result.status, 'invalid-frame');
    assert.equal(result.candidate, undefined);
    const restored = tracker.update(frame(interruptions.at(-1)[0] + 100, [stone(112)]));
    assert.equal(restored.frames, 1);
    assert.equal(restored.elapsed, 0);
  }
  const tracker = ready({ maxFrameGapMs: 3500 });
  tracker.update(frame(800, [stone(112)]));
  tracker.update(frame(1150, [stone(112)]));
  assert.equal(tracker.update(frame(1250, null, createGame(), { transient: true })).status, 'transient');
  assert.equal(tracker.update(frame(2351, [stone(112)])).frames, 1);
});

test('transient frames cannot bypass clean baseline or malformed payload checks', () => {
  const tracker = createStoneTracker({ calibration }); tracker.arm();
  tracker.update(frame(0)); tracker.update(frame(350));
  assert.equal(tracker.update(frame(500, [], createGame(), { transient: true })).status, 'invalid-frame');
  assert.equal(tracker.update(frame(850)).frames, 1);
  assert.equal(tracker.update(frame(1200)).status, 'baseline');
  assert.equal(tracker.update(frame(1550)).status, 'ready');
  assert.equal(tracker.update(frame(1650, null, createGame(), { transient: true })).status, 'invalid-frame');
  tracker.update(frame(1750, [stone(112)]));
  assert.equal(tracker.update(frame(1850, {}, createGame(), { transient: true })).status, 'invalid-frame');
  assert.equal(tracker.update(frame(1950, [stone(112)])).frames, 1);
});

test('unmarked blocking frames, conflicting candidates, and multiple stones still reset immediately', () => {
  for (const interrupt of [frame(1250, null), frame(1250, []),
    frame(1250, [stone(113)], createGame(), { transient: true }),
    frame(1250, [stone(112), stone(113)], createGame(), { transient: true }),
    frame(1250, [stone(112, { center: { x: 475, y: 430 } })], createGame(), { transient: true }),
    frame(1250, [stone(112, { confidence: .2 })], createGame(), { transient: true })]) {
    const tracker = ready();
    tracker.update(frame(800, [stone(112)])); tracker.update(frame(1150, [stone(112)]));
    assert.notEqual(tracker.update(interrupt).status, 'transient');
    const result = tracker.update(frame(1500, [stone(112)]));
    assert.equal(result.frames, 1);
    assert.equal(result.elapsed, 0);
  }
});

test('turn, game, source, and terminal gating apply before transient recovery', () => {
  for (const [game, extra, expected] of [[playMove(createGame(), 10), {}, 'paused'],
    [{ ...createGame(), winner: 1 }, {}, 'paused'], [{ ...createGame(), draw: true }, {}, 'paused'],
    [createGame(), { enabled: false }, 'paused'], [createGame(), { demo: true }, 'paused'],
    [createGame(), { mode: 'family' }, 'paused'], [createGame(), { gameId: 'new' }, 'rearm-required'],
    [createGame(), { sourceSignature: 'new' }, 'rearm-required'], [null, {}, 'invalid-frame']]) {
    const tracker = ready();
    tracker.update(frame(800, [stone(112)])); tracker.update(frame(1150, [stone(112)]));
    const result = tracker.update(frame(1250, null, game, { transient: true, ...extra }));
    assert.equal(result.status, expected);
    assert.equal(result.candidate, undefined);
  }
  const tracker = ready();
  tracker.update(frame(800, [stone(112)])); tracker.update(frame(1150, [stone(112)]));
  const advancedGame = playMove(playMove(createGame(), 10), 11);
  assert.equal(tracker.update(frame(1250, null, advancedGame, { transient: true })).status, 'invalid-frame');
  assert.equal(tracker.update(frame(1500, [stone(112)], advancedGame)).frames, 1);
});

test('transient timestamps must also increase and cannot replay an earlier valid observation', () => {
  for (const next of [frame(1200, null, createGame(), { transient: true }), frame(1199, [stone(112)])]) {
    const tracker = ready();
    tracker.update(frame(800, [stone(112)])); tracker.update(frame(1150, [stone(112)]));
    assert.equal(tracker.update(frame(1200, null, createGame(), { transient: true })).status, 'transient');
    assert.equal(tracker.update(next).status, 'stale-frame');
    assert.equal(tracker.update(frame(1500, [stone(112)])).frames, 1);
  }
});

test('nonmonotonic timestamps are discarded rather than counting a duplicated frame', () => {
  const tracker = ready();
  tracker.update(frame(800, [stone(112)]));
  assert.equal(tracker.update(frame(800, [stone(112)])).status, 'stale-frame');
  assert.equal(tracker.update(frame(1500, [stone(112)])).status, 'stabilizing');
  assert.equal(tracker.update(frame(1400, [stone(112)])).status, 'stale-frame');
});

test('only explicitly classified black stones with sufficient confidence can become candidates', () => {
  for (const extra of [{ label: 'white' }, { label: 'person' }, { label: '0' }, { confidence: 0.59 },
    { confidence: NaN }, { confidence: undefined }, { confidence: 2 }, { bbox: [1, 2, -5, 10] }]) {
    const tracker = ready();
    assert.equal(tracker.update(frame(800, [stone(112, extra)])).status, 'ready');
  }
  for (const label of ['black_stone', 'black-stone', '黑子']) {
    const tracker = ready();
    assert.equal(tracker.update(frame(800, [stone(112, { label })])).status, 'stabilizing');
  }
});

test('multiple detections of one stone are deduplicated, but two new stones pause placement', () => {
  const tracker = ready();
  tracker.update(frame(800, [stone(112), stone(112)]));
  assert.equal(tracker.update(frame(1150, [stone(112), stone(113)])).status, 'multiple');
  assert.equal(tracker.update(frame(1500, [stone(112)])).status, 'stabilizing');
  tracker.update(frame(1850, [stone(112), stone(112)]));
  assert.equal(tracker.update(frame(2200, [stone(112), stone(112)])).status, 'accepted');
});

test('unmatched or between-point black centers prevent automatic guessing', () => {
  const tracker = ready();
  const unmatched = stone(112, { center: { x: 475, y: 430 } });
  assert.equal(tracker.update(frame(800, [unmatched])).status, 'unmatched');
  assert.equal(tracker.update(frame(1150, [stone(112), unmatched])).status, 'unmatched');
  const baseline = createStoneTracker({ calibration }); baseline.arm();
  assert.equal(baseline.update(frame(0, [unmatched])).status, 'clear-required');
});

test('spare stones outside the calibrated quadrilateral never block a legal in-board move', () => {
  const tracker = ready();
  const spare = stone(112, { center: { x: 50, y: 50 } });
  assert.equal(tracker.update(frame(800, [spare])).status, 'ready');
  tracker.update(frame(900, [spare, stone(112)]));
  tracker.update(frame(1250, [spare, stone(112)]));
  assert.equal(tracker.update(frame(1600, [spare, stone(112)])).status, 'accepted');
});

test('existing digital black/white stones never become physical new moves', () => {
  const game = playMove(playMove(createGame(), 112), 113);
  const tracker = ready({}, game);
  assert.equal(tracker.update(frame(800, [stone(112), stone(113)], game)).status, 'ready');
  assert.equal(stable(tracker, 114, game, 900).status, 'accepted');
});

test('white turn, ended game, demo, family mode, and disabled input cannot place stones', () => {
  const whiteTurn = playMove(createGame(), 112);
  for (const [game, extra] of [[whiteTurn, {}], [{ ...createGame(), winner: 1 }, {}],
    [{ ...createGame(), draw: true }, {}], [createGame(), { demo: true }],
    [createGame(), { mode: 'family' }], [createGame(), { enabled: false }]]) {
    const tracker = ready();
    for (const now of [800, 1150, 1500]) assert.equal(tracker.update(frame(now, [stone(114)], game, extra)).status, 'paused');
  }
});

test('a paused frame clears partial stability before the next human turn', () => {
  const tracker = ready();
  tracker.update(frame(800, [stone(112)]));
  tracker.update(frame(1150, [stone(112)], createGame(), { enabled: false }));
  assert.equal(tracker.update(frame(1500, [stone(112)])).status, 'stabilizing');
});

test('authoritative normal black/white moves are allowed without rearming the camera', () => {
  const tracker = ready();
  assert.equal(stable(tracker).status, 'accepted');
  const black = playMove(createGame(), 112);
  assert.equal(tracker.update(frame(1600, [stone(112)], black)).status, 'paused');
  const white = playMove(black, 113);
  assert.equal(tracker.update(frame(1800, [stone(112)], white)).status, 'ready');
  assert.equal(stable(tracker, 114, white, 1900).status, 'accepted');
});

test('undo and replacement of an occupied cell automatically disarm', () => {
  const game = playMove(playMove(createGame(), 112), 113);
  const tracker = ready({}, game);
  assert.equal(tracker.update(frame(800, [stone(112)], undoRound(game))).status, 'rearm-required');
  assert.equal(tracker.getState().armed, false);
  assert.equal(tracker.update(frame(1500, [stone(112)])).status, 'disarmed');
  const changed = { ...game, board: [...game.board] }; changed.board[112] = 2;
  assert.equal(ready({}, game).update(frame(800, [], changed)).status, 'rearm-required');
});

test('new game or camera identity requires explicit rearming even if the board is still empty', () => {
  for (const extra of [{ gameId: 'game-2' }, { sourceSignature: 'camera-2:1000x900' }]) {
    const tracker = ready();
    assert.equal(tracker.update(frame(800, [], createGame(), extra)).status, 'rearm-required');
    tracker.arm();
    assert.equal(tracker.update(frame(900, [], createGame(), extra)).status, 'baseline');
  }
});

test('explicit reset then rearm prevents old physical stones from filling an undone move', () => {
  const tracker = ready(); stable(tracker);
  tracker.reset();
  assert.equal(tracker.getState().armed, false);
  tracker.arm();
  for (const now of [1600, 1950, 2300]) assert.equal(tracker.update(frame(now, [stone(112)])).status, 'clear-required');
  for (const now of [2400, 2750]) assert.equal(tracker.update(frame(now)).status, 'baseline');
  assert.equal(tracker.update(frame(3100)).status, 'ready');
  assert.equal(stable(tracker, 112, createGame(), 3200).status, 'accepted');
});

test('changing calibration disarms and does not silently keep a pending candidate', () => {
  const tracker = ready(); tracker.update(frame(800, [stone(112)]));
  tracker.setCalibration(calibration);
  assert.equal(tracker.update(frame(1500, [stone(112)])).status, 'disarmed');
  tracker.setCalibration(null);
  assert.equal(tracker.arm().status, 'uncalibrated');
});

test('tracking does not mutate the authoritative game or detection payload', () => {
  const game = createGame(); Object.freeze(game.board); Object.freeze(game.moves); Object.freeze(game);
  const detection = stone(112); Object.freeze(detection.bbox); Object.freeze(detection);
  const tracker = ready({}, game);
  const before = JSON.stringify(game);
  for (const now of [800, 1150, 1500]) tracker.update(frame(now, Object.freeze([detection]), game));
  assert.equal(JSON.stringify(game), before);
  assert.equal(game.board[112], 0);
});

const coveredStone = extra => ({ label: 'black', confidence: .95, method: 'reference-image', center: { x: 474, y: 430 }, bbox: [448, 410, 50, 40],
  coveredIntersections: [112], coverageSamples: [{ index: 112, x: 450, y: 430, current: 24, expected: 150 }], ...extra });

test('a verified unique covered crossing is accepted even outside the center tolerance', () => {
  const detection = coveredStone();
  assert.equal(nearestIntersection(calibration, detection.center), null);
  assert.equal(matchStoneDetection(calibration, detection).index, 112);
  assert.equal(matchStoneDetection(calibration, detection).matchMethod, 'coverage');
});

test('multiple covered crossings are ambiguous even when the center matches one point', () => {
  const detection = coveredStone({ center: { x: 450, y: 430 }, coveredIntersections: [112, 113], coverageSamples: [] });
  assert.equal(nearestIntersection(calibration, detection.center).index, 112);
  assert.equal(matchStoneDetection(calibration, detection), null);
});

test('bare or malformed claimed coverage cannot bypass geometric and pixel evidence checks', () => {
  for (const extra of [{ coveredIntersections: ['112'] }, { coveredIntersections: [225] }, { coveredIntersections: [NaN] },
    { coverageSamples: undefined }, { coverageSamples: [] }, { bbox: [100, 100, 500, 500] }, { bbox: [470, 410, 40, 40] },
    { center: { x: 600, y: 430 } }, { label: 'white' }, { confidence: .1 },
    { coverageSamples: [{ index: 113, x: 450, y: 430, current: 24, expected: 150 }] },
    { coverageSamples: [{ index: 112, x: 460, y: 430, current: 24, expected: 150 }] },
    { coverageSamples: [{ index: 112, x: 450, y: 430, current: 145, expected: 150 }] }]) {
    assert.equal(matchStoneDetection(calibration, coveredStone(extra)), null);
  }
});

test('YOLO boxes retain center matching, and empty reference coverage may fall back to center', () => {
  assert.equal(matchStoneDetection(calibration, coveredStone({ method: 'yolo' })), null);
  assert.equal(matchStoneDetection(calibration, coveredStone({ method: 'yolo', center: { x: 450, y: 430 } })).matchMethod, 'center');
  const empty = coveredStone({ center: { x: 450, y: 430 }, coveredIntersections: [], coverageSamples: [] });
  assert.equal(matchStoneDetection(calibration, empty).matchMethod, 'center');
});

test('coverage matching still requires stable frames and respects turn and occupied cells', () => {
  const tracker = ready(), detection = coveredStone();
  assert.equal(tracker.update(frame(800, [detection])).status, 'stabilizing');
  assert.equal(tracker.update(frame(1150, [detection])).status, 'stabilizing');
  assert.equal(tracker.update(frame(1500, [detection])).status, 'accepted');
  assert.equal(tracker.update(frame(1850, [detection])).status, 'ready');
  const game = playMove(playMove(createGame(), 112), 113);
  const occupied = ready({}, game);
  assert.equal(occupied.update(frame(800, [detection], game)).status, 'ready');
  assert.equal(ready().update(frame(800, [detection], playMove(createGame(), 1))).status, 'paused');
});
