export type ZodiacId =
  | 'aries'
  | 'taurus'
  | 'gemini'
  | 'cancer'
  | 'leo'
  | 'virgo'
  | 'libra'
  | 'scorpio'
  | 'sagittarius'
  | 'capricorn'
  | 'aquarius'
  | 'pisces';

export interface ZodiacSign {
  id: ZodiacId;
  name: string;
  /** Astronomical symbol. U+FE0E forces text (not emoji) presentation. */
  glyph: string;
  /** Traditional representation. */
  representation: string;
  /** The creature / symbolic object we render. */
  creature: string;
  /** Approximate dates, for display only. */
  dates: string;
  /**
   * Optional drop-in GLB. If `public/models/<id>.glb` exists it is loaded (and re-skinned with the
   * celestial material); otherwise the built-in procedural creature is used. See public/models/README.md.
   */
  glbFile: string;
}

const TEXT = '︎';

export const ZODIAC_SIGNS: readonly ZodiacSign[] = [
  { id: 'aries', name: 'Aries', glyph: `♈${TEXT}`, representation: 'Ram', creature: 'Celestial ram', dates: 'Mar 21 - Apr 19', glbFile: 'aries.glb' },
  { id: 'taurus', name: 'Taurus', glyph: `♉${TEXT}`, representation: 'Bull', creature: 'Celestial bull', dates: 'Apr 20 - May 20', glbFile: 'taurus.glb' },
  { id: 'gemini', name: 'Gemini', glyph: `♊${TEXT}`, representation: 'Twins', creature: 'Mirrored celestial twins', dates: 'May 21 - Jun 20', glbFile: 'gemini.glb' },
  { id: 'cancer', name: 'Cancer', glyph: `♋${TEXT}`, representation: 'Crab', creature: 'Celestial crab', dates: 'Jun 21 - Jul 22', glbFile: 'cancer.glb' },
  { id: 'leo', name: 'Leo', glyph: `♌${TEXT}`, representation: 'Lion', creature: 'Celestial lion', dates: 'Jul 23 - Aug 22', glbFile: 'leo.glb' },
  { id: 'virgo', name: 'Virgo', glyph: `♍${TEXT}`, representation: 'Maiden', creature: 'Celestial maiden', dates: 'Aug 23 - Sep 22', glbFile: 'virgo.glb' },
  { id: 'libra', name: 'Libra', glyph: `♎${TEXT}`, representation: 'Scales', creature: 'Floating celestial scales', dates: 'Sep 23 - Oct 22', glbFile: 'libra.glb' },
  { id: 'scorpio', name: 'Scorpio', glyph: `♏${TEXT}`, representation: 'Scorpion', creature: 'Celestial scorpion', dates: 'Oct 23 - Nov 21', glbFile: 'scorpio.glb' },
  { id: 'sagittarius', name: 'Sagittarius', glyph: `♐${TEXT}`, representation: 'Archer', creature: 'Centaur archer', dates: 'Nov 22 - Dec 21', glbFile: 'sagittarius.glb' },
  { id: 'capricorn', name: 'Capricorn', glyph: `♑${TEXT}`, representation: 'Sea-goat', creature: 'Celestial sea-goat', dates: 'Dec 22 - Jan 19', glbFile: 'capricorn.glb' },
  { id: 'aquarius', name: 'Aquarius', glyph: `♒${TEXT}`, representation: 'Water-bearer', creature: 'Water-bearer with vessel', dates: 'Jan 20 - Feb 18', glbFile: 'aquarius.glb' },
  { id: 'pisces', name: 'Pisces', glyph: `♓${TEXT}`, representation: 'Two fish', creature: 'Pair of celestial fish', dates: 'Feb 19 - Mar 20', glbFile: 'pisces.glb' },
];

export const DEFAULT_SIGN: ZodiacId = 'leo';

export function getSign(id: ZodiacId): ZodiacSign {
  const sign = ZODIAC_SIGNS.find((s) => s.id === id);
  if (!sign) throw new Error(`Unknown zodiac sign: ${id}`);
  return sign;
}

export function isZodiacId(value: unknown): value is ZodiacId {
  return typeof value === 'string' && ZODIAC_SIGNS.some((s) => s.id === value);
}
