/**
 * The filled part of a slider: the stylesheet paints a range input's track
 * in the accent up to `--gob-range-fill` and plain after it, so every place
 * that changes a slider's value (or its range) calls {@link syncRangeFill}.
 * CSS has no way to read an input's value, hence the property.
 */

/**
 * How far along its track a value sits, as a CSS percentage: clamped to the
 * track, and 0% for an empty or nonsense range (an audio player before the
 * recording's length is known has max 0).
 */
export function rangeFillPercent(value: number, min: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return "0%";
  }
  const share = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return `${Math.round(share * 10000) / 100}%`;
}

/**
 * The value a slider takes under a finger at `x` (`range-drag.ts`): the knob's
 * centre travels from half a knob in from one end of the track to half a knob
 * in from the other, as the browser draws it, and the value lands on a step
 * counted from `min` (any value for `step` "any" or 0). A press past either
 * end takes that end.
 */
export function rangeValueAt(
  x: number,
  left: number,
  width: number,
  min: number,
  max: number,
  step: number,
  knob: number,
): number {
  if (!(max > min)) return Number.isFinite(min) ? min : 0;
  const travel = width - knob;
  const share = travel > 0 ? (x - left - knob / 2) / travel : x >= left + width / 2 ? 1 : 0;
  const raw = min + Math.min(1, Math.max(0, share)) * (max - min);
  if (!(step > 0)) return raw;
  // The browser keeps a value on the last whole step below `max`.
  const steps = Math.min(Math.round((raw - min) / step), Math.floor((max - min) / step + 1e-9));
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number((min + steps * step).toFixed(Math.min(decimals + 2, 12)));
}

/** Bring a slider's filled part in line with its value. */
export function syncRangeFill(range: HTMLInputElement): void {
  range.setCssProps({
    "--gob-range-fill": rangeFillPercent(
      Number(range.value),
      Number(range.min || 0),
      Number(range.max || 100),
    ),
  });
}
