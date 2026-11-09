import { DEFAULT_SIGN, isZodiacId, type ZodiacId } from '../data/zodiacSigns';

export interface EngineSettings {
  /** name the app uses on screeen */
  displayName: string;
  /** less particles, lower res, cheaper effects for weaker PCs */
  lowEffects: boolean;
  /** no bright flashes, slower pulse, softer glow; also default if the OS asks for reduced motion */
  reducedFlash: boolean;
  /** draw hand/face landamrks and show perf numbers */
  showDebug: boolean;
}

export interface QualityProfile {
  maxParticles: number;
  /** cap on devicePixelRatio for the canvases, kinda */
  dprCap: number;
  sparkleCap: number;
  /** sparkle emit per second per hand */
  auraRate: number;
  /** used to tweak glow on eyes / aura / stars */
  glow: number;
  /** timing scale for the cinematic phases; reduced flash is a bit slower and gentler */
  phaseScale: number;
}

export function qualityFor(s: EngineSettings): QualityProfile {
  const base: QualityProfile = s.lowEffects
    ? { maxParticles: 2400, dprCap: 1, sparkleCap: 420, auraRate: 70, glow: 1, phaseScale: 1 }
    : { maxParticles: 6000, dprCap: 1.5, sparkleCap: 1500, auraRate: 190, glow: 1, phaseScale: 1 };
  if (s.reducedFlash) {
    base.glow = 0.65;
    base.phaseScale = 1.25;
  }
  return base;
}

const KEY = 'cosmic.settings.v1';
const SIGN_KEY = 'cosmic.sign.v1';

export function defaultSettings(): EngineSettings {
  let prefersReduced = false;
  try {
    prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    /* just skip it */
  }
  return { displayName: 'Canopus', lowEffects: false, reducedFlash: prefersReduced, showDebug: false };
}

export function loadSettings(): EngineSettings {
  const defaults = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<EngineSettings>;
    return {
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName.trim().slice(0, 24) || 'Canopus' : defaults.displayName,
      lowEffects: typeof parsed.lowEffects === 'boolean' ? parsed.lowEffects : defaults.lowEffects,
      reducedFlash: typeof parsed.reducedFlash === 'boolean' ? parsed.reducedFlash : defaults.reducedFlash,
      showDebug: typeof parsed.showDebug === 'boolean' ? parsed.showDebug : defaults.showDebug,
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: EngineSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* local storage can be weird in private mode */
  }
}

export function loadSign(): ZodiacId {
  try {
    const v = localStorage.getItem(SIGN_KEY);
    return isZodiacId(v) ? v : DEFAULT_SIGN;
  } catch {
    return DEFAULT_SIGN;
  }
}

export function saveSign(id: ZodiacId): void {
  try {
    localStorage.setItem(SIGN_KEY, id);
  } catch {
    /* no biggie */
  }
}
