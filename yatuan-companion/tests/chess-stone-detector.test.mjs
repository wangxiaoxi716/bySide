import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrateBoard, nearestIntersection, matchStoneDetection, createStoneTracker } from '../dist/chess-vision-core.js';
import { createGame } from '../dist/chess-core.js';
import { detectReferenceStones } from '../dist/chess-stone-detector.js';

const cal = calibrateBoard([{x:30,y:30},{x:450,y:30},{x:450,y:450},{x:30,y:450}],480,480);
function frame() { const data = new Uint8ClampedArray(480*480*4); for (let i=0;i<data.length;i+=4) { data[i]=140;data[i+1]=150;data[i+2]=120;data[i+3]=255; } return {width:480,height:480,data}; }
function paint(source, cx, cy, radius, shade=24) { const target={...source,data:source.data.slice()};for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(Math.hypot(x-cx,y-cy)<=radius){let i=(y*source.width+x)*4;target.data[i]=target.data[i+1]=target.data[i+2]=shade;}return target; }
function square(source, cx, cy, size, shade = 24) {
  const target = { ...source, data: source.data.slice() };
  for (let y = 0; y < 480; y++) for (let x = 0; x < 480; x++) {
    if (Math.abs(x - cx) <= size / 2 && Math.abs(y - cy) <= size / 2) {
      const i = (y * 480 + x) * 4;
      target.data[i] = target.data[i + 1] = target.data[i + 2] = shade;
    }
  }
  return target;
}
const indices = result => result.detections.map(stone => matchStoneDetection(cal, stone)?.index);
test('reference mode distinguishes empty board and a new black stone',()=>{const ref=frame();assert.equal(detectReferenceStones(ref,ref,cal).detections.length,0);const actual=paint(ref,240,240,11);const result=detectReferenceStones(actual,ref,cal);assert.equal(result.blocked,false);assert.deepEqual(indices(result),[112]);});
test('occupied digital stones are ignored to prevent projection feedback',()=>{const ref=frame(),board=Array(225).fill(0);board[112]=1;assert.equal(detectReferenceStones(paint(ref,240,240,11),ref,cal,{board}).detections.length,0);});
test('white stones do not produce black candidates',()=>{const ref=frame();assert.equal(detectReferenceStones(paint(ref,240,240,11,240),ref,cal).detections.length,0);});
test('broad shadows or hands pause detection instead of becoming a move',()=>{const ref=frame();const result=detectReferenceStones(paint(ref,240,240,90),ref,cal);assert.equal(result.blocked,true);assert.equal(result.detections.length,0);});
test('two separate black stones remain separate for tracker rejection',()=>{const ref=frame();const result=detectReferenceStones(paint(paint(ref,240,240,11),ref.width/2+60,240,11),ref,cal);assert.deepEqual(indices(result),[112,114]);});
test('changed image dimensions require recalibration',()=>{const ref=frame();assert.throws(()=>detectReferenceStones({...ref,width:240},ref,cal),/尺寸/);});

test('candidate center is measured from dark pixels rather than pre-snapped to an intersection', () => {
  const reference = frame();
  const result = detectReferenceStones(paint(reference, 245, 240, 11), reference, cal);
  assert.equal(result.blocked, false);
  assert.equal(result.detections.length, 1);
  const detection = result.detections[0];
  assert.ok(detection.center.x > 242 && detection.center.x < 247);
  assert.ok(Math.abs(detection.center.y - 240) < 1);
  assert.equal('index' in detection, false);
  assert.equal(nearestIntersection(cal, detection.center).index, 112);
  assert.ok(detection.bbox[0] < detection.center.x && detection.bbox[0] + detection.bbox[2] > detection.center.x);
});

test('existing projected black and white stones do not hide a new neighboring physical stone', () => {
  const reference = frame();
  for (const player of [1, 2]) {
    const board = Array(225).fill(0); board[112] = player;
    const old = detectReferenceStones(paint(reference, 240, 240, 14), reference, cal, { board });
    assert.equal(old.blocked, false);
    assert.equal(old.detections.length, 0);
    const current = paint(paint(reference, 240, 240, 11), 270, 240, 11);
    const result = detectReferenceStones(current, reference, cal, { board });
    assert.equal(result.blocked, false);
    assert.deepEqual(indices(result), [113]);
  }
});

test('one local shadow or oversized dark patch blocks instead of appearing clean', () => {
  const reference = frame();
  for (const radius of [16, 18, 20, 22, 24, 90]) {
    const result = detectReferenceStones(paint(reference, 240, 240, radius), reference, cal);
    assert.equal(result.blocked, true, `radius ${radius} should block`);
    assert.equal(result.detections.length, 0);
  }
});

test('centers beyond the nearest-point tolerance still produce uncertainty instead of a clean frame', () => {
  const reference = frame();
  for (const [dx, dy] of [[14, 0], [15, 0], [10, 10], [12, 12], [15, 15]]) {
    const result = detectReferenceStones(paint(reference, 240 + dx, 240 + dy, 11), reference, cal);
    assert.equal(result.blocked, true, `offset ${dx},${dy} should block`);
    assert.equal(result.detections.length, 0);
  }
});

test('compact round stones are detected before snapping, including 0.2–0.4 cell offsets', () => {
  const reference = frame();
  for (const [dx, dy] of [[6, 0], [7, 0], [10, 0], [12, 0], [-10, 0], [0, 10], [0, -10], [8, 8]]) {
    const result = detectReferenceStones(paint(reference, 240 + dx, 240 + dy, 11), reference, cal);
    assert.equal(result.blocked, false, `offset ${dx},${dy}`);
    assert.deepEqual(indices(result), [112]);
    assert.ok(Math.abs(result.detections[0].center.x - 240 - dx) < 1);
    assert.ok(Math.abs(result.detections[0].center.y - 240 - dy) < 1);
  }
});

test('one correct and one misaligned new stone cannot be reduced to one playable candidate', () => {
  const reference = frame();
  const current = paint(paint(reference, 240, 240, 11), 315, 240, 11);
  const result = detectReferenceStones(current, reference, cal);
  assert.equal(result.blocked, true);
  assert.equal(result.detections.length, 0);
});

test('insufficient sampling margins at any frame edge require recalibration', () => {
  const reference = frame();
  for (const margin of [0, 1, 8, 17]) {
    const edge = calibrateBoard([{ x: margin, y: margin }, { x: 420 + margin, y: margin },
      { x: 420 + margin, y: 420 + margin }, { x: margin, y: 420 + margin }], 480, 480);
    assert.throws(() => detectReferenceStones(reference, reference, edge), /画面边缘/);
  }
  const rightEdge = calibrateBoard([{ x: 60, y: 30 }, { x: 479, y: 30 }, { x: 479, y: 450 }, { x: 60, y: 450 }], 480, 480);
  assert.throws(() => detectReferenceStones(reference, reference, rightEdge), /画面边缘/);
});

test('all four outer corner stones are detected when the full sampling ring is in frame', () => {
  const reference = frame();
  for (const index of [0, 14, 224, 210]) {
    const point = cal.intersections[index];
    const result = detectReferenceStones(paint(reference, point.x, point.y, 11), reference, cal);
    assert.equal(result.blocked, false);
    assert.deepEqual(indices(result), [index]);
  }
});

test('truncated pixel buffers cannot be mistaken for a clean frame', () => {
  const reference = frame();
  assert.throws(() => detectReferenceStones({ ...reference, data: reference.data.slice(0, 16) }, reference, cal), /尺寸/);
});

test('shadow frames cannot establish the tracker clean baseline', () => {
  const reference = frame(), game = createGame();
  const shadow = detectReferenceStones(paint(reference, 240, 240, 20), reference, cal);
  const tracker = createStoneTracker({ calibration: cal }); tracker.arm();
  for (const now of [0, 350, 700]) {
    const result = tracker.update({ detections: shadow.blocked ? null : shadow.detections, game, now });
    assert.equal(result.status, 'invalid-frame');
  }
  const revealed = detectReferenceStones(paint(reference, 240, 240, 11), reference, cal);
  for (const now of [1050, 1400, 1750]) {
    assert.equal(tracker.update({ detections: revealed.detections, game, now }).status, 'clear-required');
  }
});

test('repeated auxiliary detections become exactly one move through the stable tracker', () => {
  const reference = frame(), game = createGame(), tracker = createStoneTracker({ calibration: cal });
  tracker.arm();
  for (const now of [0, 350, 700]) tracker.update({ detections: [], game, now });
  const detected = detectReferenceStones(paint(reference, 243, 240, 11), reference, cal);
  const results = [800, 1150, 1500, 1850, 2200].map(now => tracker.update({ detections: detected.detections, game, now }));
  assert.equal(results.filter(result => result.status === 'accepted').length, 1);
  assert.equal(results.find(result => result.status === 'accepted').index, 112);
});

test('a compact, high-contrast square token near one cell in size maps by its measured centroid', () => {
  const reference = frame();
  const result = detectReferenceStones(square(reference, 235, 243, 29), reference, cal);
  assert.equal(result.blocked, false);
  assert.deepEqual(indices(result), [112]);
  assert.equal(result.detections[0].shape, 'compact-square');
  assert.ok(Math.abs(result.detections[0].center.x - 235) < 1.5);
  assert.ok(Math.abs(result.detections[0].center.y - 243) < 1.5);
});

test('the footprint of an occupied square token does not block subsequent turns', () => {
  const reference = frame(), board = Array(225).fill(0); board[112] = 1;
  const old = square(reference, 235, 243, 29);
  const existing = detectReferenceStones(old, reference, cal, { board });
  assert.equal(existing.blocked, false);
  assert.equal(existing.detections.length, 0);
  const next = detectReferenceStones(paint(old, 300, 240, 11), reference, cal, { board });
  assert.equal(next.blocked, false);
  assert.deepEqual(indices(next), [114]);
});

test('two compact square tokens remain two candidates and are never merged', () => {
  const reference = frame();
  const result = detectReferenceStones(square(square(reference, 240, 240, 29), 330, 240, 29), reference, cal);
  assert.equal(result.blocked, false);
  assert.deepEqual(indices(result), [112, 115]);
});

test('oversized and low-contrast square patches still block as uncertain changes', () => {
  const reference = frame();
  for (const [size, shade] of [[40, 24], [60, 24], [29, 85]]) {
    const result = detectReferenceStones(square(reference, 240, 240, size, shade), reference, cal);
    assert.equal(result.blocked, true, `size ${size}, shade ${shade}`);
    assert.equal(result.detections.length, 0);
  }
});

test('a compact square cannot explain away another misaligned stone', () => {
  const reference = frame();
  const result = detectReferenceStones(paint(square(reference, 235, 243, 29), 315, 240, 11), reference, cal);
  assert.equal(result.blocked, true);
  assert.equal(result.detections.length, 0);
});

function brightness(source, delta) {
  const target = { ...source, data: source.data.slice() };
  for (let i = 0; i < target.data.length; i += 4) for (let channel = 0; channel < 3; channel++) target.data[i + channel] += delta;
  return target;
}

test('moderate global exposure changes do not create stones or hide an offset stone', () => {
  const reference = frame();
  for (const delta of [-35, -20, 20, 35]) {
    const shifted = brightness(reference, delta);
    const empty = detectReferenceStones(shifted, reference, cal);
    assert.equal(empty.blocked, false);
    assert.equal(empty.detections.length, 0);
    assert.ok(Math.abs(empty.diagnostics.exposureShift + delta) < 1);
    const actual = detectReferenceStones(paint(shifted, 250, 240, 11, Math.max(0, 24 + delta)), reference, cal);
    assert.equal(actual.blocked, false, `exposure ${delta}`);
    assert.deepEqual(indices(actual), [112]);
  }
});

test('large exposure jumps are rejected and cannot establish a clean baseline', () => {
  const reference = frame();
  const result = detectReferenceStones(brightness(reference, -65), reference, cal);
  assert.equal(result.blocked, true);
  assert.equal(result.diagnostics.rejections[0].code, 'exposure');
});

test('small round stones remain detectable on low-resolution 10–20 pixel grid spacing', () => {
  for (const spacing of [10, 12, 16, 20]) {
    const width = spacing * 14 + 40, data = new Uint8ClampedArray(width * width * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = 140; data[i + 1] = 150; data[i + 2] = 120; data[i + 3] = 255; }
    const reference = { width, height: width, data };
    const calibration = calibrateBoard([{ x: 20, y: 20 }, { x: width - 20, y: 20 }, { x: width - 20, y: width - 20 }, { x: 20, y: width - 20 }], width, width);
    const middle = 20 + 7 * spacing;
    for (const offset of [.2, .3, .35]) {
      const result = detectReferenceStones(paint(reference, middle + spacing * offset, middle, spacing * .30), reference, calibration);
      assert.equal(result.blocked, false, `spacing ${spacing}, offset ${offset}`);
      assert.equal(result.detections.length, 1);
      assert.equal(nearestIntersection(calibration, result.detections[0].center)?.index, 112);
    }
  }
});

test('two separated offset stones remain two candidates while touching pieces are uncertain', () => {
  const reference = frame();
  const two = detectReferenceStones(paint(paint(reference, 250, 240, 11), 340, 240, 11), reference, cal);
  assert.equal(two.blocked, false);
  assert.deepEqual(indices(two), [112, 115]);
  const touching = detectReferenceStones(paint(paint(reference, 240, 240, 11), 259, 240, 11), reference, cal);
  assert.equal(touching.blocked, true);
  assert.equal(touching.detections.length, 0);
});

test('an accepted offset stone and its projected counterpart never produce a duplicate', () => {
  const reference = frame(), board = Array(225).fill(0); board[112] = 1;
  const union = paint(paint(reference, 240, 240, 10), 250, 240, 11);
  const old = detectReferenceStones(union, reference, cal, { board });
  assert.equal(old.blocked, false);
  assert.equal(old.detections.length, 0);
  assert.equal(old.diagnostics.ignoredOccupied, 1);
  const next = detectReferenceStones(paint(union, 300, 240, 11), reference, cal, { board });
  assert.equal(next.blocked, false);
  assert.deepEqual(indices(next), [114]);
});

test('rejected compact objects keep a diagnostic preview and a specific reason', () => {
  const reference = frame();
  const result = detectReferenceStones(paint(reference, 255, 240, 11), reference, cal);
  assert.equal(result.blocked, true);
  assert.equal(result.detections.length, 0);
  assert.equal(result.diagnostics.rejections[0].code, 'off-grid');
  assert.equal(result.diagnostics.previewDetections.length, 1);
  assert.equal(result.diagnostics.previewDetections[0].rejected, true);
  assert.equal(result.diagnostics.previewDetections[0].label, 'black');
  assert.ok(result.diagnostics.previewDetections[0].bbox.length === 4);
});

test('physical dark pixels covering one crossing are sufficient even when the center is farther away', () => {
  const reference = frame();
  for (const current of [paint(reference, 254, 240, 14), square(reference, 254, 240, 29)]) {
    const result = detectReferenceStones(current, reference, cal);
    assert.equal(result.blocked, false);
    assert.deepEqual(indices(result), [112]);
    const detection = result.detections[0];
    assert.equal(nearestIntersection(cal, detection.center), null);
    assert.deepEqual(detection.coveredIntersections, [112]);
    assert.equal(matchStoneDetection(cal, detection).matchMethod, 'coverage');
    const tracker = createStoneTracker({ calibration: cal }); tracker.arm();
    for (const now of [0, 350, 700]) tracker.update({ detections: [], game: createGame(), now });
    for (const now of [800, 1150]) tracker.update({ detections: result.detections, game: createGame(), now });
    assert.equal(tracker.update({ detections: result.detections, game: createGame(), now: 1500 }).index, 112);
  }
});

test('one dark object covering two crossings pauses instead of choosing one', () => {
  const reference = frame();
  const result = detectReferenceStones(square(reference, 255, 240, 31), reference, cal);
  assert.equal(result.blocked, true);
  assert.equal(result.detections.length, 0);
  assert.equal(result.diagnostics.rejections[0].code, 'multiple-covered');
  assert.deepEqual(result.diagnostics.previewDetections[0].coveredIntersections, [112, 113]);
  assert.equal(matchStoneDetection(cal, result.diagnostics.previewDetections[0]), null);
});

test('a bounding box covering a crossing is insufficient without an actual dark mask pixel there', () => {
  const reference = frame();
  const result = detectReferenceStones(paint(reference, 252, 252, 13), reference, cal);
  assert.equal(result.blocked, true);
  const preview = result.diagnostics.previewDetections[0];
  assert.ok(preview.bbox[0] < 240 && preview.bbox[1] < 240);
  assert.deepEqual(preview.coveredIntersections, []);
  assert.equal(matchStoneDetection(cal, preview), null);
});

test('a few weak background speckles do not veto a clear black stone', () => {
  const reference = frame();
  const current = paint(paint(reference, 240, 240, 11), 115, 115, 4, 95);
  const result = detectReferenceStones(current, reference, cal);
  assert.equal(result.blocked, false);
  assert.deepEqual(indices(result), [112]);
  assert.equal(result.diagnostics.softNoise.length, 1);
});

test('broad weak shadows and many weak patches still block a clear black stone', () => {
  const reference = frame();
  const broad = paint(paint(reference, 240, 240, 11), 115, 115, 35, 95);
  assert.equal(detectReferenceStones(broad, reference, cal).blocked, true);
  let scattered = paint(reference, 240, 240, 11);
  for (const [x,y] of [[80,80],[140,80],[200,80],[260,80]]) scattered = paint(scattered,x,y,4,95);
  const result = detectReferenceStones(scattered,reference,cal);
  assert.equal(result.blocked,true);
  assert.equal(result.diagnostics.rejections.at(-1).code,'background-noise');
});
