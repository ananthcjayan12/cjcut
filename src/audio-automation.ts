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
  if (!clip.fadeIn && !clip.fadeOut && !(clip.volumeKeyframes ?? []).length) {
    return [{ ...clip, duration: leftDuration }, { ...clip, duration: rightDuration }];
  }
  // Materialize the original envelope before splitting. A new cut must not
  // introduce a new fade-to-zero at either cut edge or restart the old fade.
  const cuts = [0, splitAt, clip.duration, Math.min(clip.duration, Math.max(0, clip.fadeIn ?? 0)),
    Math.max(0, clip.duration - (clip.fadeOut ?? 0)), ...(clip.volumeKeyframes ?? []).map(point => point.time)];
  const ordered = [...new Set(cuts.filter(t => Number.isFinite(t) && t >= 0 && t <= clip.duration))]
    .sort((a, b) => a - b);
  const times: number[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    times.push(ordered[i]);
    if (i + 1 < ordered.length && (clip.fadeIn || clip.fadeOut) && ordered[i + 1] - ordered[i] > 0.12) {
      times.push((ordered[i] + ordered[i + 1]) / 2);
    }
  }
  const leftPoints = times.filter(t => t <= splitAt)
    .map(time => ({ time, gain: volumeEnvelopeAt(clip, time, clip.duration) }));
  const rightPoints = times.filter(t => t >= splitAt)
    .map(time => ({ time: time - splitAt, gain: volumeEnvelopeAt(clip, time, clip.duration) }));
  return [
    { ...clip, duration: leftDuration, fadeIn: 0, fadeOut: 0, volumeKeyframes: leftPoints },
    { ...clip, duration: rightDuration, fadeIn: 0, fadeOut: 0, volumeKeyframes: rightPoints },
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
