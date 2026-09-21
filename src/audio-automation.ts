export type AudioKeyframe = { time: number; gain: number };
export type AudioAutomation = {
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  volumeKeyframes?: AudioKeyframe[];
};
export const unit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));

/** Clip-local seconds, measured in OUTPUT timeline time (not source time). */
export function volumeEnvelopeAt(clip: AudioAutomation, localTime: number, duration: number): number {
  const t = Math.max(0, Math.min(duration, localTime));
  const points = (clip.volumeKeyframes ?? []).filter(p => Number.isFinite(p.time) && Number.isFinite(p.gain))
    .map(p => ({ time: Math.max(0, Math.min(duration, p.time)), gain: unit(p.gain) }))
    .sort((a, b) => a.time - b.time);
  let gain = 1;
  if (points.length) {
    gain = points[0].gain;
    for (let i = 1; i < points.length; i += 1) {
      if (t < points[i].time) {
        const previous = points[i - 1];
        const span = points[i].time - previous.time;
        gain = span > 0.000001 ? previous.gain + (points[i].gain - previous.gain) * (t - previous.time) / span : points[i].gain;
        break;
      }
      gain = points[i].gain;
    }
  }
  const fadeIn = Math.min(duration, Math.max(0, clip.fadeIn ?? 0));
  const fadeOut = Math.min(duration, Math.max(0, clip.fadeOut ?? 0));
  const entrance = fadeIn > 0 ? Math.min(1, t / fadeIn) : 1;
  const exit = fadeOut > 0 ? Math.min(1, (duration - t) / fadeOut) : 1;
  return unit(gain * entrance * exit);
}

/** Preserve gain curve across split, with independent trim- and undo-friendly halves. */
export function splitAudioAutomation<T extends AudioAutomation & { duration: number }>(clip: T, splitAt: number): [T, T] {
  const leftDuration = splitAt;
  const rightDuration = clip.duration - splitAt;
  const points = (clip.volumeKeyframes ?? []).filter(p => p.time >= 0 && p.time <= clip.duration)
    .sort((a, b) => a.time - b.time);
  const rawGainAt = (time: number) => volumeEnvelopeAt({ volumeKeyframes: points }, time, clip.duration);
  const splitGain = rawGainAt(splitAt);
  const leftPoints = points.filter(p => p.time < splitAt).map(p => ({ ...p }));
  const rightPoints = points.filter(p => p.time > splitAt).map(p => ({ time: p.time - splitAt, gain: p.gain }));
  if (points.length) {
    leftPoints.push({ time: splitAt, gain: splitGain });
    rightPoints.unshift({ time: 0, gain: splitGain });
  }
  const originalFadeIn = Math.max(0, clip.fadeIn ?? 0);
  const originalFadeOut = Math.max(0, clip.fadeOut ?? 0);
  const fadeOutStart = clip.duration - originalFadeOut;
  return [
    { ...clip, duration: leftDuration,
      fadeIn: Math.min(originalFadeIn, leftDuration),
      fadeOut: Math.min(leftDuration, Math.max(0, splitAt - Math.max(0, fadeOutStart))),
      volumeKeyframes: leftPoints,
    },
    { ...clip, duration: rightDuration,
      fadeIn: Math.min(rightDuration, Math.max(0, originalFadeIn - splitAt)),
      fadeOut: Math.min(rightDuration, originalFadeOut),
      volumeKeyframes: rightPoints,
    },
  ];
}

/** FFmpeg's volume filter evaluates t in the output clip's local time. */
export function ffmpegKeyframeExpression(points: AudioKeyframe[] | undefined, duration: number): string {
  const ordered = (points ?? []).filter(p => Number.isFinite(p.time) && Number.isFinite(p.gain))
    .map(p => ({ time: Math.max(0, Math.min(duration, p.time)), gain: unit(p.gain) }))
    .sort((a, b) => a.time - b.time);
  if (!ordered.length) return '1';
  const fmt = (n: number) => Number(n.toFixed(6)).toString();
  let expression = fmt(ordered[ordered.length - 1].gain);
  for (let i = ordered.length - 2; i >= 0; i -= 1) {
    const left = ordered[i], right = ordered[i + 1];
    const span = Math.max(0.000001, right.time - left.time);
    const ramp = `(${fmt(left.gain)}+(${fmt(right.gain)}-${fmt(left.gain)})*(t-${fmt(left.time)})/${fmt(span)})`;
    expression = `if(lt(t,${fmt(right.time)}),${ramp},${expression})`;
  }
  return `if(lt(t,${fmt(ordered[0].time)}),${fmt(ordered[0].gain)},${expression})`;
}
