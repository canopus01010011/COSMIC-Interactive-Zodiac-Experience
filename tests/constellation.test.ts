import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConstellationModel } from '../src/constellation/constellation';
import { AppEvent, AppState, canTransition, transition } from '../src/app/stateMachine';
import { ZODIAC_SIGNS, getSign, isZodiacId } from '../src/data/zodiacSigns';

describe('ConstellationModel', () => {
  it('stores stars and strokes in normalised coordinates', () => {
    const c = new ConstellationModel();
    c.apply({ type: 'STAR_HOLD', point: { x: 0.25, y: 0.5 }, t: 1 });
    c.apply({ type: 'STAR_HOLD', point: { x: 0.75, y: 0.5 }, t: 2 });
    c.apply({ type: 'DRAW_START', point: { x: 0.26, y: 0.51 }, t: 3 });
    for (let i = 1; i <= 20; i++) c.apply({ type: 'DRAW_MOVE', point: { x: 0.26 + i * 0.024, y: 0.5 }, t: 3 + i });
    c.apply({ type: 'DRAW_END', reason: 'released', t: 30 });
    assert.equal(c.stars.stars.length, 2);
    assert.equal(c.strokes.strokes.length, 1);
    for (const s of c.stars.stars) assert.ok(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1);
  });

  it('snaps stroke ends to nearby stars and records the connection', () => {
    const c = new ConstellationModel();
    c.apply({ type: 'STAR_HOLD', point: { x: 0.25, y: 0.5 }, t: 1 });
    c.apply({ type: 'STAR_HOLD', point: { x: 0.75, y: 0.5 }, t: 2 });
    c.apply({ type: 'DRAW_START', point: { x: 0.26, y: 0.51 }, t: 3 });
    for (let i = 1; i <= 20; i++) c.apply({ type: 'DRAW_MOVE', point: { x: 0.26 + i * 0.0245, y: 0.505 }, t: 3 + i });
    c.apply({ type: 'DRAW_END', reason: 'released', t: 30 });
    const stroke = c.strokes.strokes[0];
    assert.equal(stroke.startStarId, c.stars.stars[0].id);
    assert.equal(stroke.endStarId, c.stars.stars[1].id);
    assert.deepEqual(stroke.points[0], { x: 0.25, y: 0.5 });
    assert.deepEqual(stroke.points[stroke.points.length - 1], { x: 0.75, y: 0.5 });
  });

  it('discards tiny strokes', () => {
    const c = new ConstellationModel();
    c.apply({ type: 'DRAW_START', point: { x: 0.5, y: 0.5 }, t: 1 });
    c.apply({ type: 'DRAW_MOVE', point: { x: 0.501, y: 0.5 }, t: 2 });
    c.apply({ type: 'DRAW_END', reason: 'released', t: 3 });
    assert.equal(c.strokes.strokes.length, 0);
  });

  it('rejects overlapping stars', () => {
    const c = new ConstellationModel();
    c.apply({ type: 'STAR_HOLD', point: { x: 0.5, y: 0.5 }, t: 1 });
    c.apply({ type: 'STAR_HOLD', point: { x: 0.505, y: 0.5 }, t: 2 });
    assert.equal(c.stars.stars.length, 1);
  });

  it('freezes: no mutation afterwards, and snapshots are immutable deep copies', () => {
    const c = new ConstellationModel();
    c.apply({ type: 'STAR_HOLD', point: { x: 0.5, y: 0.5 }, t: 1 });
    c.apply({ type: 'DRAW_START', point: { x: 0.2, y: 0.2 }, t: 2 });
    for (let i = 1; i <= 15; i++) c.apply({ type: 'DRAW_MOVE', point: { x: 0.2 + i * 0.02, y: 0.2 }, t: 2 + i });
    c.freeze(); // closes the open stroke
    assert.equal(c.strokes.strokes.length, 1);
    const snap = c.snapshot();
    c.apply({ type: 'STAR_HOLD', point: { x: 0.9, y: 0.9 }, t: 99 });
    assert.equal(c.stars.stars.length, 1, 'frozen model ignores new stars');
    assert.equal(snap.stars.length, 1);
    assert.ok(Object.isFrozen(snap));
    snap.strokes[0].points[0].x = 999;
    assert.notEqual(c.strokes.strokes[0].points[0].x, 999, 'snapshot is a deep copy');
    c.unfreeze();
    c.clear();
    assert.ok(c.isEmpty);
  });

  it('undo removes the latest stroke first, then stars', () => {
    const c = new ConstellationModel();
    c.apply({ type: 'STAR_HOLD', point: { x: 0.1, y: 0.1 }, t: 1 });
    c.apply({ type: 'DRAW_START', point: { x: 0.3, y: 0.3 }, t: 2 });
    for (let i = 1; i <= 10; i++) c.apply({ type: 'DRAW_MOVE', point: { x: 0.3 + i * 0.02, y: 0.3 }, t: 2 + i });
    c.apply({ type: 'DRAW_END', reason: 'released', t: 20 });
    c.undo();
    assert.equal(c.strokes.strokes.length, 0);
    assert.equal(c.stars.stars.length, 1);
    c.undo();
    assert.equal(c.stars.stars.length, 0);
  });
});

describe('state machine', () => {
  const walk = (start: AppState, events: AppEvent[]): AppState => events.reduce(transition, start);

  it('follows the happy path from the specification', () => {
    assert.equal(
      walk('START', ['CAMERA_OK', 'TRACKING_READY', 'STAR_GESTURE', 'GESTURE_RELEASED', 'DRAW_GESTURE', 'FINISH_GESTURE']),
      'TRANSFORMING',
    );
    assert.equal(walk('TRANSFORMING', ['TRANSFORM_DONE']), 'CREATURE_MODE');
    assert.equal(walk('CREATURE_MODE', ['RESTART']), 'IDLE');
  });

  it('routes camera failures to CAMERA_ERROR from anywhere and allows retry', () => {
    for (const s of ['START', 'CAMERA_READY', 'IDLE', 'STAR_MODE', 'DRAW_MODE', 'TRANSFORMING', 'CREATURE_MODE'] as AppState[]) {
      assert.equal(transition(s, 'CAMERA_FAIL'), 'CAMERA_ERROR', s);
    }
    assert.equal(transition('CAMERA_ERROR', 'RETRY'), 'START');
  });

  it('can cancel a transformation', () => {
    assert.equal(transition('TRANSFORMING', 'CANCEL'), 'IDLE');
  });

  it('ignores events that are not valid in the current state', () => {
    assert.equal(transition('START', 'FINISH_GESTURE'), 'START');
    assert.equal(transition('CREATURE_MODE', 'STAR_GESTURE'), 'CREATURE_MODE');
    assert.equal(transition('TRANSFORMING', 'DRAW_GESTURE'), 'TRANSFORMING');
    assert.ok(!canTransition('IDLE', 'RESTART'));
  });

  it('camera off returns to START from every live state', () => {
    for (const s of ['CAMERA_READY', 'IDLE', 'STAR_MODE', 'DRAW_MODE', 'TRANSFORMING', 'CREATURE_MODE'] as AppState[]) {
      assert.equal(transition(s, 'CAMERA_OFF'), 'START', s);
    }
  });
});

describe('zodiac data', () => {
  it('has all twelve signs with unique ids and text-presentation glyphs', () => {
    assert.equal(ZODIAC_SIGNS.length, 12);
    assert.equal(new Set(ZODIAC_SIGNS.map((s) => s.id)).size, 12);
    for (const s of ZODIAC_SIGNS) {
      assert.ok(s.glyph.endsWith('︎'), `${s.id} glyph forces text presentation`);
      assert.ok(isZodiacId(s.id));
    }
    assert.equal(getSign('leo').representation, 'Lion');
    assert.ok(!isZodiacId('ophiuchus'));
  });
});
