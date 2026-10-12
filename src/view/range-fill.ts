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
