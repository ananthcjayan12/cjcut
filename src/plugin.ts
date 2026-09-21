import './styles.css'
export { CJCutEditor, START_PROJECT } from './App'
export type {
  CJCutEditorProps,
  Project as CJCutProject,
  Track as CJCutTrack,
  Clip as CJCutClip,
  TrackType as CJCutTrackType,
  MediaKind as CJCutMediaKind,
  MediaAsset as CJCutMediaAsset,
} from './App'

export { volumeEnvelopeAt, splitAudioAutomation, ffmpegKeyframeExpression } from './audio-automation'
export type { AudioKeyframe, AudioAutomation } from './audio-automation'

export { splitTimelineClip } from './timeline-operations'
export type { TimelineSplitResult } from './timeline-operations'
