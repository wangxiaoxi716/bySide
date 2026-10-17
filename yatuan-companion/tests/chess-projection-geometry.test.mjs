import test from 'node:test';
import assert from 'node:assert/strict';
import { projectionGeometry, isProjectionGeometry, updateProjectionBinding } from '../dist/chess-projection-geometry.js';

test('projection geometry reports every rendered SVG intersection and clockwise corners', () => {
  const result = projectionGeometry({ left: 400, top: 200, width: 480, height: 480 }, 1280, 880);
  assert.equal(result.intersections.length, 225);
  assert.deepEqual(result.corners.map(point => point.label), ['A1', 'O1', 'O15', 'A15']);
  assert.deepEqual(result.intersections[0], { index: 0, label: 'A1', x: 416, y: 216 });
  assert.deepEqual(result.intersections[112], { index: 112, label: 'H8', x: 640, y: 440 });
  assert.deepEqual(result.intersections[224], { index: 224, label: 'O15', x: 864, y: 664 });
  assert.equal(isProjectionGeometry(result), true);
});

test('resize scales coordinates and changes signature, not grid identities', () => {
  const first = projectionGeometry({ left: 100, top: 50, width: 240, height: 240 }, 440, 340);
  const next = projectionGeometry({ left: 200, top: 100, width: 480, height: 480 }, 880, 680);
  assert.deepEqual(first.intersections[14], { index: 14, label: 'O1', x: 332, y: 58 });
  assert.equal(next.intersections[14].x, first.intersections[14].x * 2);
  assert.equal(next.intersections[14].y, first.intersections[14].y * 2);
  assert.notEqual(first.signature, next.signature);
});

test('hidden or nonfinite SVG dimensions are rejected', () => {
  assert.equal(projectionGeometry({ left: 0, top: 0, width: 0, height: 0 }, 1200, 800), null);
  assert.equal(projectionGeometry({ left: NaN, top: 0, width: 480, height: 480 }, 1200, 800), null);
});

test('owner rejects malformed peer point data and mismatched corner labels', () => {
  const make = () => projectionGeometry({ left: 100, top: 50, width: 480, height: 480 }, 1200, 800);
  const cases = [null, {}, { ...make(), intersections: [] }];
  const badIndex = make(); badIndex.intersections[50].index = 0; cases.push(badIndex);
  const badCoordinate = make(); badCoordinate.intersections[50].x = Infinity; cases.push(badCoordinate);
  const badCorner = make(); badCorner.corners[0].label = 'O15'; cases.push(badCorner);
  const outsideViewport = make(); outsideViewport.intersections[50].x = 3000; cases.push(outsideViewport);
  cases.forEach(value => assert.equal(isProjectionGeometry(value), false));
});

test('first projection binds by default while passive mirrors cannot change or clear its geometry', () => {
  const geometry = projectionGeometry({ left: 100, top: 50, width: 480, height: 480 }, 1200, 800);
  const first = updateProjectionBinding({ initialized: false, activeProjectionId: null, geometry: null }, { type: 'projection-geometry', projectionId: 'screen-A', geometry });
  assert.equal(first.activeProjectionId, 'screen-A');
  const otherGeometry = projectionGeometry({ left: 300, top: 150, width: 480, height: 480 }, 1400, 900);
  assert.equal(updateProjectionBinding(first, { type: 'projection-geometry', projectionId: 'screen-B', geometry: otherGeometry }), first);
  assert.equal(updateProjectionBinding(first, { type: 'projection-geometry', projectionId: 'screen-B', geometry: null }), first);
  assert.equal(updateProjectionBinding(first, { type: 'projection-release', projectionId: 'screen-B' }), first);
  assert.equal(updateProjectionBinding(first, { type: 'projection-geometry', projectionId: 'screen-A', geometry }), first);
});

test('explicit claim changes the binding even for identical viewport geometry', () => {
  const geometry = projectionGeometry({ left: 100, top: 50, width: 480, height: 480 }, 1200, 800);
  const first = { initialized: true, activeProjectionId: 'screen-A', geometry };
  const claimed = updateProjectionBinding(first, { type: 'projection-claim', projectionId: 'screen-B', geometry });
  assert.equal(claimed.activeProjectionId, 'screen-B');
  assert.equal(claimed.geometry, geometry);
  assert.equal(updateProjectionBinding(claimed, { type: 'projection-release', projectionId: 'screen-A' }), claimed);
  assert.equal(updateProjectionBinding(claimed, { type: 'projection-claim', projectionId: 'screen-C', geometry: null }), claimed);
});

test('hiding keeps the binding, closing releases it, and passive geometry does not auto-rebind', () => {
  const geometry = projectionGeometry({ left: 100, top: 50, width: 480, height: 480 }, 1200, 800);
  const first = { initialized: true, activeProjectionId: 'screen-A', geometry };
  const hidden = updateProjectionBinding(first, { type: 'projection-geometry', projectionId: 'screen-A', geometry: null });
  assert.equal(hidden.activeProjectionId, 'screen-A');
  assert.equal(hidden.geometry, null);
  const shown = updateProjectionBinding(hidden, { type: 'projection-geometry', projectionId: 'screen-A', geometry });
  assert.equal(shown.geometry, geometry);
  const released = updateProjectionBinding(shown, { type: 'projection-release', projectionId: 'screen-A' });
  assert.deepEqual(released, { initialized: true, activeProjectionId: null, geometry: null });
  assert.equal(updateProjectionBinding(released, { type: 'projection-geometry', projectionId: 'screen-B', geometry }), released);
  assert.equal(updateProjectionBinding(released, { type: 'projection-claim', projectionId: 'screen-B', geometry }).activeProjectionId, 'screen-B');
});

test('invalid projection identities or geometries never establish a binding', () => {
  const empty = { initialized: false, activeProjectionId: null, geometry: null };
  const geometry = projectionGeometry({ left: 100, top: 50, width: 480, height: 480 }, 1200, 800);
  for (const command of [null, { type: 'projection-geometry', projectionId: 'bad id', geometry }, { type: 'projection-geometry', projectionId: 'screen-A', geometry: null }, { type: 'projection-claim', projectionId: 'screen-A', geometry: {} }]) assert.equal(updateProjectionBinding(empty, command), empty);
});
