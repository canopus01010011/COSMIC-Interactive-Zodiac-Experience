import { ZODIAC_SIGNS, type ZodiacId } from '../data/zodiacSigns';

interface Props {
  value: ZodiacId;
  disabled: boolean;
  onChange: (id: ZodiacId) => void;
}

export function SignSelector({ value, disabled, onChange }: Props) {
  return (
    <div className="signs" role="radiogroup" aria-label="Zodiac sign">
      {ZODIAC_SIGNS.map((s) => (
        <button
          key={s.id}
          role="radio"
          aria-checked={s.id === value}
          className={`sign ${s.id === value ? 'on' : ''}`}
          disabled={disabled}
          title={`${s.name} - ${s.creature}`}
          onClick={() => onChange(s.id)}
        >
          <span className="glyph" aria-hidden="true">{s.glyph}</span>
          <span className="sr">{s.name}</span>
        </button>
      ))}
    </div>
  );
}
