import { GestureRecognizer, type GestureEvent, type GestureUpdate } from '../src/gestures/gestureRecognizer';
import { buildMockHand, type MockHandSpec } from '../src/vision/mockHand';
import type { VisionFrame } from '../src/vision/landmarkTypes';

export const ASPECT = 16 / 9;
export const FRAME_MS = 1000 / 30;

export function frame(t: number, specs: MockHandSpec[]): VisionFrame {
  return {
    t,
    hands: specs.map((s) => buildMockHand({ aspect: ASPECT, ...s })),
    face: null,
    aspect: ASPECT,
  };
}

/** Feeds `durationMs` of frames at 30 fps. `specAt(tMs)` returns the hands for that moment. */
export function run(
  rec: GestureRecognizer,
  startT: number,
  durationMs: number,
  specAt: (localMs: number) => MockHandSpec[],
  events: GestureEvent[] = [],
): { endT: number; events: GestureEvent[]; last: GestureUpdate | null } {
  let last: GestureUpdate | null = null;
  let t = startT;
  const end = startT + durationMs;
  while (t < end) {
    last = rec.update(frame(t, specAt(t - startT)));
    events.push(...last.events);
    t += FRAME_MS;
  }
  return { endT: t, events, last };
}

export const count = (events: GestureEvent[], type: GestureEvent['type']): number =>
  events.filter((e) => e.type === type).length;
