import type { Clip, Project } from './App'

export type TimelineSplitResult =
  | { ok: true; project: Project; leftId: string; rightId: string }
  | { ok: false; reason: string }

/** Pure timeline operation: no React state, no mutation of the incoming project. */
export function splitTimelineClip(
  project: Project,
  selectedClipId: string | null,
  playhead: number,
  rightClipId: string,
  minimumDuration = 0.05,
): TimelineSplitResult {
  if (!Number.isFinite(playhead) || playhead < 0) return { ok: false, reason: 'Move the playhead onto the clip you want to split.' }
  if (!selectedClipId) return { ok: false, reason: 'Select a clip on the timeline first, then position the playhead inside it.' }
  const track = project.tracks.find(item => item.clips.some(clip => clip.id === selectedClipId))
  const original = track?.clips.find(clip => clip.id === selectedClipId)
  if (!track || !original) return { ok: false, reason: 'Select an existing timeline clip first.' }
  if (track.locked) return { ok: false, reason: 'Unlock this track before splitting its clips.' }
  const leftDuration = playhead - original.start
  const rightDuration = original.duration - leftDuration
  if (leftDuration < minimumDuration || rightDuration < minimumDuration) {
    return { ok: false, reason: 'Move the playhead inside the selected clip, away from its start and end.' }
  }
  const cloneProject: Project = JSON.parse(JSON.stringify(project))
  const changedTrack = cloneProject.tracks.find(item => item.id === track.id)!
  const left = changedTrack.clips.find(clip => clip.id === selectedClipId)!
  const right: Clip = {
    ...JSON.parse(JSON.stringify(left)),
    id: rightClipId,
    name: left.name + ' cut',
    start: playhead,
    duration: rightDuration,
    sourceStart: left.sourceStart + leftDuration * left.speed,
  }
  left.duration = leftDuration
  changedTrack.clips.push(right)
  return { ok: true, project: cloneProject, leftId: left.id, rightId: right.id }
}
