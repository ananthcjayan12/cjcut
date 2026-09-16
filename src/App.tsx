import {
  ChevronDown, Copy, Download, Eye, EyeOff, Film, FolderOpen, Image as ImageIcon,
  Layers3, Lock, Maximize2, Music2, Pause, Play, Plus, Redo2, RotateCcw,
  Scissors, Settings2, SkipBack, SkipForward, Sparkles, Trash2, Type, Undo2,
  Unlock, Upload, Volume2, ZoomIn, ZoomOut
} from 'lucide-react'
import { ChangeEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'

type TrackType = 'video' | 'image' | 'audio' | 'text'
type MediaKind = Exclude<TrackType, 'text'>

type MediaAsset = {
  id: string
  name: string
  kind: MediaKind
  url: string
  duration: number
  width?: number
  height?: number
}

type Clip = {
  id: string
  trackId: string
  type: TrackType
  name: string
  mediaId?: string
  url?: string
  start: number
  duration: number
  sourceStart: number
  sourceDuration: number
  text?: string
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
  volume: number
  speed: number
}

type Track = {
  id: string
  name: string
  type: TrackType
  visible: boolean
  locked: boolean
  clips: Clip[]
}

type Project = {
  name: string
  width: number
  height: number
  fps: number
  duration: number
  tracks: Track[]
}

type DragState = {
  mode: 'move' | 'trim-left' | 'trim-right'
  clipId: string
  trackId: string
  startX: number
  initialStart: number
  initialDuration: number
  initialSourceStart: number
  snapshot: Project
}

const uid = () => Math.random().toString(36).slice(2, 10)
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

const START_PROJECT: Project = {
  name: 'My Project',
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 30,
  tracks: [
    { id: 'overlay', name: 'Video 2', type: 'image', visible: true, locked: false, clips: [] },
    { id: 'video', name: 'Video 1', type: 'video', visible: true, locked: false, clips: [] },
    { id: 'audio', name: 'Audio 1', type: 'audio', visible: true, locked: false, clips: [] },
    {
      id: 'text',
      name: 'Text 1',
      type: 'text',
      visible: true,
      locked: false,
      clips: [{
        id: 'welcome-title',
        trackId: 'text',
        type: 'text',
        name: 'Title',
        start: 1.5,
        duration: 4,
        sourceStart: 0,
        sourceDuration: 4,
        text: 'CJCut',
        x: 50,
        y: 78,
        scale: 1,
        rotation: 0,
        opacity: 1,
        volume: 1,
        speed: 1,
      }],
    },
  ],
}

const TRACK_COLORS: Record<TrackType, string> = {
  video: 'clip-video',
  image: 'clip-image',
  audio: 'clip-audio',
  text: 'clip-text',
}

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds)
  const mins = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  const frames = Math.floor((safe % 1) * 100)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(frames).padStart(2, '0')}`
}

function App() {
  const [project, setProject] = useState<Project>(START_PROJECT)
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>('welcome-title')
  const [playhead, setPlayhead] = useState(2.2)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [snap, setSnap] = useState(true)
  const [leftTab, setLeftTab] = useState<'media' | 'text' | 'audio'>('media')
  const [past, setPast] = useState<Project[]>([])
  const [future, setFuture] = useState<Project[]>([])
  const [clipboard, setClipboard] = useState<Clip | null>(null)
  const [showExport, setShowExport] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const scrubbingRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const previewRefs = useRef<Record<string, HTMLVideoElement | HTMLAudioElement | null>>({})

  const pxPerSecond = 44 * zoom
  const selected = useMemo(() => {
    for (const track of project.tracks) {
      const found = track.clips.find(c => c.id === selectedClipId)
      if (found) return found
    }
    return null
  }, [project, selectedClipId])

  const visibleClips = useMemo(() =>
    project.tracks
      .filter(t => t.visible)
      .flatMap((t, trackIndex) => t.clips.map(c => ({ clip: c, trackIndex })))
      .filter(({ clip }) => playhead >= clip.start && playhead < clip.start + clip.duration),
  [project, playhead])

  const activeMediaKey = useMemo(() =>
    visibleClips
      .filter(({ clip }) => clip.url && (clip.type === 'video' || clip.type === 'audio'))
      .map(({ clip }) => clip.id)
      .sort()
      .join('|'),
  [visibleClips])

  const pushSnapshot = (snapshot: Project) => {
    setPast(p => [...p.slice(-49), clone(snapshot)])
    setFuture([])
  }

  const commit = (updater: (p: Project) => Project) => {
    setProject(current => {
      pushSnapshot(current)
      return updater(clone(current))
    })
  }

  const undo = () => {
    setPast(p => {
      if (!p.length) return p
      const previous = p[p.length - 1]
      setFuture(f => [clone(project), ...f].slice(0, 50))
      setProject(clone(previous))
      return p.slice(0, -1)
    })
  }

  const redo = () => {
    setFuture(f => {
      if (!f.length) return f
      const next = f[0]
      setPast(p => [...p, clone(project)].slice(-50))
      setProject(clone(next))
      return f.slice(1)
    })
  }

  const findTrack = (id: string) => project.tracks.find(t => t.id === id)

  const updateSelected = (patch: Partial<Clip>) => {
    if (!selectedClipId) return
    commit(p => {
      p.tracks.forEach(track => {
        const clip = track.clips.find(c => c.id === selectedClipId)
        if (clip) Object.assign(clip, patch)
      })
      return p
    })
  }

  const deleteSelected = () => {
    if (!selectedClipId || !selected) return
    commit(p => {
      const track = p.tracks.find(t => t.id === selected.trackId)
      if (!track || track.locked) return p

      const deleted = track.clips.find(c => c.id === selectedClipId)
      if (!deleted) return p

      const deletedEnd = deleted.start + deleted.duration
      track.clips = track.clips
        .filter(c => c.id !== selectedClipId)
        .map(c => c.start >= deletedEnd - 0.0001
          ? { ...c, start: Math.max(deleted.start, c.start - deleted.duration) }
          : c)

      return p
    })
    setPlayhead(selected.start)
    setSelectedClipId(null)
  }

  const splitSelected = () => {
    if (!selected) return
    if (playhead <= selected.start + 0.05 || playhead >= selected.start + selected.duration - 0.05) return
    commit(p => {
      const track = p.tracks.find(t => t.id === selected.trackId)
      if (!track || track.locked) return p
      const original = track.clips.find(c => c.id === selected.id)
      if (!original) return p
      const leftDuration = playhead - original.start
      const rightDuration = original.duration - leftDuration
      const right: Clip = {
        ...clone(original),
        id: uid(),
        name: original.name + ' cut',
        start: playhead,
        duration: rightDuration,
        sourceStart: original.sourceStart + leftDuration * original.speed,
      }
      original.duration = leftDuration
      track.clips.push(right)
      setSelectedClipId(right.id)
      return p
    })
  }

  const duplicateSelected = () => {
    if (!selected) return
    commit(p => {
      const track = p.tracks.find(t => t.id === selected.trackId)
      if (!track) return p
      const copy = { ...clone(selected), id: uid(), start: selected.start + selected.duration + 0.15, name: selected.name + ' copy' }
      track.clips.push(copy)
      p.duration = Math.max(p.duration, copy.start + copy.duration + 2)
      setSelectedClipId(copy.id)
      return p
    })
  }

  const pasteClip = () => {
    if (!clipboard) return
    commit(p => {
      const track = p.tracks.find(t => t.id === clipboard.trackId) ?? p.tracks.find(t => t.type === clipboard.type)
      if (!track) return p
      const copy = { ...clone(clipboard), id: uid(), trackId: track.id, start: playhead, name: clipboard.name + ' copy' }
      track.clips.push(copy)
      setSelectedClipId(copy.id)
      return p
    })
  }

  const snapTime = (value: number, ignoreId?: string) => {
    if (!snap) return Math.max(0, value)
    const points = [0, playhead]
    project.tracks.forEach(t => t.clips.forEach(c => {
      if (c.id !== ignoreId) points.push(c.start, c.start + c.duration)
    }))
    const threshold = 7 / pxPerSecond
    const nearest = points.reduce((best, point) =>
      Math.abs(point - value) < Math.abs(best - value) ? point : best, points[0] ?? value)
    return Math.abs(nearest - value) <= threshold ? Math.max(0, nearest) : Math.max(0, value)
  }

  const beginClipDrag = (event: ReactPointerEvent, clip: Clip, mode: DragState['mode']) => {
    event.stopPropagation()
    const track = findTrack(clip.trackId)
    if (track?.locked) return
    setSelectedClipId(clip.id)
    dragRef.current = {
      mode,
      clipId: clip.id,
      trackId: clip.trackId,
      startX: event.clientX,
      initialStart: clip.start,
      initialDuration: clip.duration,
      initialSourceStart: clip.sourceStart,
      snapshot: clone(project),
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  const moveClipDrag = (event: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const delta = (event.clientX - drag.startX) / pxPerSecond
    setProject(p => {
      const next = clone(p)
      const track = next.tracks.find(t => t.id === drag.trackId)
      const clip = track?.clips.find(c => c.id === drag.clipId)
      if (!clip) return p
      if (drag.mode === 'move') {
        clip.start = snapTime(drag.initialStart + delta, drag.clipId)
      } else if (drag.mode === 'trim-right') {
        const raw = Math.max(0.15, drag.initialDuration + delta)
        const maxDuration = Math.max(0.15, (clip.sourceDuration - drag.initialSourceStart) / clip.speed)
        clip.duration = Math.min(raw, maxDuration)
      } else {
        const maxDelta = drag.initialDuration - 0.15
        const applied = Math.min(Math.max(delta, -drag.initialSourceStart / clip.speed), maxDelta)
        const newStart = snapTime(drag.initialStart + applied, drag.clipId)
        const actualDelta = newStart - drag.initialStart
        clip.start = newStart
        clip.duration = Math.max(0.15, drag.initialDuration - actualDelta)
        clip.sourceStart = Math.max(0, drag.initialSourceStart + actualDelta * clip.speed)
      }
      next.duration = Math.max(30, ...next.tracks.flatMap(t => t.clips.map(c => c.start + c.duration + 2)))
      return next
    })
  }

  const endClipDrag = () => {
    const drag = dragRef.current
    if (!drag) return
    pushSnapshot(drag.snapshot)
    dragRef.current = null
  }

  const setPlayheadFromClientX = (clientX: number) => {
    const timeline = timelineRef.current
    if (!timeline) return
    const rect = timeline.getBoundingClientRect()
    const laneLabelWidth = 190
    const x = clientX - rect.left + timeline.scrollLeft - laneLabelWidth
    setPlayhead(Math.max(0, Math.min(project.duration, x / pxPerSecond)))
  }

  const beginTimelineScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    setPlaying(false)
    scrubbingRef.current = true
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    setPlayheadFromClientX(event.clientX)
  }

  const moveTimelineScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return
    setPlayheadFromClientX(event.clientX)
  }

  const endTimelineScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return
    setPlayheadFromClientX(event.clientX)
    scrubbingRef.current = false
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  }

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      lastFrameRef.current = null
      return
    }
    const tick = (time: number) => {
      if (lastFrameRef.current == null) lastFrameRef.current = time
      const delta = (time - lastFrameRef.current) / 1000
      lastFrameRef.current = time
      setPlayhead(current => {
        const next = current + delta
        if (next >= project.duration) {
          setPlaying(false)
          return 0
        }
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [playing, project.duration])

  // Keep media playback continuous. Re-seeking a <video>/<audio> element on every
  // animation frame forces the browser decoder to flush repeatedly and causes
  // visible frame stalls and distorted/choppy audio.
  useEffect(() => {
    if (!playing) return

    const activeIds = new Set(activeMediaKey ? activeMediaKey.split('|') : [])
    Object.entries(previewRefs.current).forEach(([id, element]) => {
      if (element && !activeIds.has(id)) element.pause()
    })

    visibleClips.forEach(({ clip }) => {
      if (!clip.url || (clip.type !== 'video' && clip.type !== 'audio')) return
      const el = previewRefs.current[clip.id]
      if (!el) return

      const target = clip.sourceStart + (playhead - clip.start) * clip.speed
      try { el.currentTime = Math.max(0, target) } catch { /* metadata may still be loading */ }
      el.volume = Math.max(0, Math.min(1, clip.volume))
      el.playbackRate = Math.max(0.25, Math.min(4, clip.speed))
      el.play().catch(() => undefined)
    })
    // Sync once when playback starts or the active clip set changes. From there,
    // the browser media clock is allowed to run without repeated seeks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, activeMediaKey])

  // While paused/scrubbing we do want frame-accurate seeking so the preview
  // follows the playhead immediately.
  useEffect(() => {
    if (playing) return
    visibleClips.forEach(({ clip }) => {
      if (!clip.url || (clip.type !== 'video' && clip.type !== 'audio')) return
      const el = previewRefs.current[clip.id]
      if (!el) return
      const target = clip.sourceStart + (playhead - clip.start) * clip.speed
      if (Math.abs(el.currentTime - target) > 0.015) {
        try { el.currentTime = Math.max(0, target) } catch { /* metadata may still be loading */ }
      }
      el.volume = Math.max(0, Math.min(1, clip.volume))
      el.playbackRate = Math.max(0.25, Math.min(4, clip.speed))
      el.pause()
    })
  }, [playhead, playing, activeMediaKey, visibleClips])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const mod = e.metaKey || e.ctrlKey
      if (e.code === 'Space') { e.preventDefault(); setPlaying(v => !v); return }
      if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); splitSelected(); return }
      if (mod && e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); redo(); return }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return }
      if (mod && e.key.toLowerCase() === 'c' && selected) { e.preventDefault(); setClipboard(clone(selected)); return }
      if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClip(); return }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) { e.preventDefault(); deleteSelected(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setPlayhead(t => Math.max(0, t - (e.shiftKey ? 1 : 1 / project.fps))); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); setPlayhead(t => Math.min(project.duration, t + (e.shiftKey ? 1 : 1 / project.fps))); return }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(z => Math.min(3, z + 0.2)); return }
      if (mod && e.key === '-') { e.preventDefault(); setZoom(z => Math.max(0.5, z - 0.2)); return }
      if (e.key === 'Escape') setSelectedClipId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const readMediaMetadata = (url: string, kind: MediaKind) =>
    new Promise<{duration: number; width?: number; height?: number}>(resolve => {
      if (kind === 'image') {
        const image = new window.Image()
        image.onload = () => resolve({
          duration: 5,
          width: image.naturalWidth || undefined,
          height: image.naturalHeight || undefined,
        })
        image.onerror = () => resolve({ duration: 5 })
        image.src = url
        return
      }

      const el = document.createElement(kind === 'audio' ? 'audio' : 'video')
      el.preload = 'metadata'
      el.onloadedmetadata = () => resolve({
        duration: Number.isFinite(el.duration) ? el.duration : 5,
        width: kind === 'video' && el instanceof HTMLVideoElement ? el.videoWidth || undefined : undefined,
        height: kind === 'video' && el instanceof HTMLVideoElement ? el.videoHeight || undefined : undefined,
      })
      el.onerror = () => resolve({ duration: 5 })
      el.src = url
    })

  const importMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    const assets: MediaAsset[] = []
    for (const file of files) {
      const kind: MediaKind | null = file.type.startsWith('video/') ? 'video'
        : file.type.startsWith('audio/') ? 'audio'
        : file.type.startsWith('image/') ? 'image' : null
      if (!kind) continue
      const url = URL.createObjectURL(file)
      const metadata = await readMediaMetadata(url, kind)
      assets.push({ id: uid(), name: file.name, kind, url, ...metadata })
    }
    setMedia(current => [...current, ...assets])
    event.target.value = ''
  }

  const addAsset = (asset: MediaAsset) => {
    commit(p => {
      const hasPrimaryVideo = p.tracks.some(t => t.type === 'video' && t.clips.length > 0)
      if (asset.kind === 'video' && !hasPrimaryVideo && asset.width && asset.height) {
        p.width = asset.width
        p.height = asset.height
      }

      let track = p.tracks.find(t => t.type === asset.kind && !t.locked)
      if (!track && asset.kind === 'image') track = p.tracks.find(t => t.id === 'overlay')
      if (!track) {
        track = { id: uid(), name: asset.kind + ' ' + (p.tracks.length + 1), type: asset.kind, visible: true, locked: false, clips: [] }
        p.tracks.unshift(track)
      }
      const clip: Clip = {
        id: uid(), trackId: track.id, type: asset.kind, name: asset.name, mediaId: asset.id, url: asset.url,
        start: playhead, duration: asset.kind === 'image' ? 5 : asset.duration,
        sourceStart: 0, sourceDuration: asset.duration,
        x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 1, speed: 1,
      }
      track.clips.push(clip)
      p.duration = Math.max(p.duration, clip.start + clip.duration + 2)
      setSelectedClipId(clip.id)
      return p
    })
  }

  const addText = () => {
    commit(p => {
      let track = p.tracks.find(t => t.type === 'text')
      if (!track) {
        track = { id: uid(), name: 'Text', type: 'text', visible: true, locked: false, clips: [] }
        p.tracks.push(track)
      }
      const clip: Clip = {
        id: uid(), trackId: track.id, type: 'text', name: 'Text', text: 'Add your text',
        start: playhead, duration: 4, sourceStart: 0, sourceDuration: 4,
        x: 50, y: 76, scale: 1, rotation: 0, opacity: 1, volume: 1, speed: 1,
      }
      track.clips.push(clip)
      setSelectedClipId(clip.id)
      return p
    })
  }

  const toggleTrack = (id: string, key: 'visible' | 'locked') => {
    commit(p => {
      const track = p.tracks.find(t => t.id === id)
      if (track) track[key] = !track[key]
      return p
    })
  }

  const addTrack = () => {
    commit(p => {
      const count = p.tracks.filter(t => t.type === 'video' || t.type === 'image').length + 1
      p.tracks.unshift({ id: uid(), name: 'Video ' + count, type: 'image', visible: true, locked: false, clips: [] })
      return p
    })
  }

  const exportProject = () => {
    const clean = clone(project)
    clean.tracks.forEach(t => t.clips.forEach(c => { if (c.url?.startsWith('blob:')) delete c.url }))
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${project.name.replace(/\s+/g, '-').toLowerCase()}.cjcut.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const incoming = JSON.parse(await file.text()) as Project
      if (!Array.isArray(incoming.tracks)) throw new Error('Invalid project')
      pushSnapshot(project)
      setProject(incoming)
      setSelectedClipId(null)
      setPlayhead(0)
    } catch {
      alert('This does not look like a valid CJCut project file.')
    }
    event.target.value = ''
  }

  const ticks = useMemo(() => {
    const step = zoom < 0.75 ? 5 : zoom < 1.5 ? 2 : 1
    const values: number[] = []
    for (let t = 0; t <= project.duration; t += step) values.push(t)
    return values
  }, [project.duration, zoom])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">C</div><strong>CJCut</strong></div>
        <nav className="menu"><button>File</button><button>Edit</button><button>View</button><button>Help</button></nav>
        <div className="project-title"><span>{project.name}</span><ChevronDown size={14}/></div>
        <div className="top-actions">
          <button className="icon-btn" onClick={undo} disabled={!past.length} title="Undo (Ctrl/Cmd+Z)"><Undo2 size={18}/></button>
          <button className="icon-btn" onClick={redo} disabled={!future.length} title="Redo (Ctrl/Cmd+Shift+Z)"><Redo2 size={18}/></button>
          <button className="ratio-btn" title="Project resolution detected from the primary video"><Maximize2 size={15}/> {project.width}×{project.height}</button>
          <button className="export-btn" onClick={() => setShowExport(true)}><Download size={17}/> Export</button>
          <button className="icon-btn"><Settings2 size={18}/></button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-panel">
          <div className="rail">
            <button className={leftTab === 'media' ? 'active' : ''} onClick={() => setLeftTab('media')}><FolderOpen/><span>Media</span></button>
            <button className={leftTab === 'text' ? 'active' : ''} onClick={() => setLeftTab('text')}><Type/><span>Text</span></button>
            <button className={leftTab === 'audio' ? 'active' : ''} onClick={() => setLeftTab('audio')}><Music2/><span>Audio</span></button>
            <button><Sparkles/><span>Elements</span></button>
          </div>
          <div className="asset-panel">
            {leftTab === 'media' && <>
              <div className="panel-tabs"><button className="active">Import</button><button>Record</button><button>Stock</button></div>
              <button className="drop-zone" onClick={() => fileInputRef.current?.click()}>
                <Upload size={25}/><strong>Import Media</strong><span>Videos, images or audio</span>
              </button>
              <input ref={fileInputRef} hidden type="file" multiple accept="video/*,audio/*,image/*" onChange={importMedia}/>
              <div className="asset-filter"><button className="active">All</button><button>Video</button><button>Image</button><button>Audio</button></div>
              <div className="asset-grid">
                {media.length === 0 && <div className="empty-assets">Your imported media will appear here.</div>}
                {media.map(asset => (
                  <button key={asset.id} className="asset-card" onClick={() => addAsset(asset)} title="Click to add at playhead">
                    <div className="asset-thumb">
                      {asset.kind === 'image' ? <img src={asset.url}/> :
                       asset.kind === 'video' ? <video src={asset.url}/> : <Music2 size={28}/>}
                      <span className="asset-duration">{asset.kind !== 'image' ? formatTime(asset.duration).slice(3) : 'IMG'}</span>
                    </div>
                    <span>{asset.name}</span>
                  </button>
                ))}
              </div>
            </>}
            {leftTab === 'text' && <div className="simple-panel">
              <h3>Text</h3><p>Add a text layer at the current playhead.</p>
              <button className="primary-wide" onClick={addText}><Plus size={17}/> Add text</button>
              <div className="text-preset"><strong>Heading</strong><span>Clean bold title</span></div>
              <div className="text-preset subtle"><strong>Caption</strong><span>Simple subtitle</span></div>
            </div>}
            {leftTab === 'audio' && <div className="simple-panel">
              <h3>Audio</h3><p>Import music or narration, then click it to add it to the timeline.</p>
              <button className="primary-wide" onClick={() => fileInputRef.current?.click()}><Upload size={17}/> Import audio</button>
            </div>}
          </div>
        </aside>

        <section className="preview-section">
          <div className="preview-stage">
            <div className="canvas" style={{ aspectRatio: `${project.width}/${project.height}` }}>
              {visibleClips.filter(v => v.clip.type !== 'audio').length === 0 && (
                <div className="canvas-empty"><Film size={44}/><strong>Import media to start editing</strong><span>Your preview appears here</span></div>
              )}
              {visibleClips
                .filter(({ clip }) => clip.type !== 'audio')
                .sort((a,b) => b.trackIndex - a.trackIndex)
                .map(({ clip }) => (
                  <div key={clip.id} className={`preview-layer ${clip.type === 'video' || clip.type === 'image' ? 'media-layer' : ''} ${selectedClipId === clip.id ? 'selected' : ''}`}
                    style={{ left: clip.x + '%', top: clip.y + '%', opacity: clip.opacity, transform: `translate(-50%,-50%) scale(${clip.scale}) rotate(${clip.rotation}deg)` }}
                    onClick={(e) => { e.stopPropagation(); setSelectedClipId(clip.id) }}>
                    {clip.type === 'video' && clip.url && <video ref={el => { previewRefs.current[clip.id] = el }} src={clip.url} muted={clip.volume === 0} playsInline />}
                    {clip.type === 'image' && clip.url && <img src={clip.url}/>}
                    {clip.type === 'text' && <div className="preview-text">{clip.text}</div>}
                  </div>
                ))}
              {visibleClips.filter(({clip}) => clip.type === 'audio' && clip.url).map(({clip}) =>
                <audio key={clip.id} ref={el => { previewRefs.current[clip.id] = el }} src={clip.url}/>
              )}
            </div>
          </div>
          <div className="transport">
            <div className="time-readout"><strong>{formatTime(playhead)}</strong><span>/ {formatTime(project.duration)}</span></div>
            <div className="transport-buttons">
              <button onClick={() => setPlayhead(t => Math.max(0, t - 1))}><SkipBack size={18}/></button>
              <button className="play-btn" onClick={() => setPlaying(v => !v)}>{playing ? <Pause size={22}/> : <Play size={22} fill="currentColor"/>}</button>
              <button onClick={() => setPlayhead(t => Math.min(project.duration, t + 1))}><SkipForward size={18}/></button>
            </div>
            <div className="fit-control">Fit <ChevronDown size={13}/></div>
          </div>
        </section>

        <aside className="properties">
          <div className="property-tabs"><button className="active">Video</button><button>Audio</button><button>Speed</button><button>Animation</button></div>
          {!selected ? <div className="no-selection"><Layers3 size={31}/><strong>No clip selected</strong><span>Select a clip on the timeline to edit its properties.</span></div> : <>
            <section className="property-section">
              <h4><ChevronDown size={15}/> Transform</h4>
              <div className="coord-row"><label>Position</label><div><span>X</span><input type="number" value={Math.round(selected.x)} onChange={e => updateSelected({x:+e.target.value})}/><span>Y</span><input type="number" value={Math.round(selected.y)} onChange={e => updateSelected({y:+e.target.value})}/></div></div>
              <Range label="Scale" min={0.25} max={2.5} step={0.05} value={selected.scale} suffix={Math.round(selected.scale*100)+'%'} onChange={value => updateSelected({scale:value})}/>
              <Range label="Rotation" min={-180} max={180} step={1} value={selected.rotation} suffix={Math.round(selected.rotation)+'°'} onChange={value => updateSelected({rotation:value})}/>
              <Range label="Opacity" min={0} max={1} step={0.01} value={selected.opacity} suffix={Math.round(selected.opacity*100)+'%'} onChange={value => updateSelected({opacity:value})}/>
            </section>
            {selected.type === 'text' && <section className="property-section">
              <h4><ChevronDown size={15}/> Text</h4>
              <textarea value={selected.text ?? ''} onChange={e => updateSelected({text:e.target.value})}/>
            </section>}
            {(selected.type === 'video' || selected.type === 'audio') && <section className="property-section">
              <h4><ChevronDown size={15}/> Audio</h4>
              <Range label="Volume" min={0} max={1} step={0.01} value={selected.volume} suffix={Math.round(selected.volume*100)+'%'} onChange={value => updateSelected({volume:value})}/>
              <Range label="Speed" min={0.25} max={4} step={0.05} value={selected.speed} suffix={selected.speed.toFixed(2)+'×'} onChange={value => updateSelected({speed:value})}/>
            </section>}
          </>}
        </aside>

        <section className="timeline-panel">
          <div className="timeline-toolbar">
            <div className="edit-tools">
              <button onClick={undo} title="Undo"><Undo2 size={17}/></button>
              <button onClick={redo} title="Redo"><Redo2 size={17}/></button>
              <span className="divider"/>
              <button className="tool-with-label" onClick={splitSelected}><Scissors size={17}/> Split <kbd>Ctrl+B</kbd></button>
              <button className="tool-with-label" onClick={deleteSelected}><Trash2 size={17}/> Delete</button>
              <button className="tool-with-label" onClick={duplicateSelected}><Copy size={17}/> Duplicate</button>
              <button className={`tool-with-label ${snap ? 'is-on' : ''}`} onClick={() => setSnap(v => !v)}>Snap</button>
            </div>
            <div className="zoom-tools">
              <ZoomOut size={16}/><input type="range" min=".5" max="3" step=".1" value={zoom} onChange={e => setZoom(+e.target.value)}/><ZoomIn size={16}/>
            </div>
          </div>
          <div className="timeline-scroll" ref={timelineRef}>
            <div className="timeline-inner" style={{ width: 190 + project.duration * pxPerSecond + 120 }}>
              <div className="ruler-row timeline-scrub-zone"
                onPointerDown={beginTimelineScrub}
                onPointerMove={moveTimelineScrub}
                onPointerUp={endTimelineScrub}
                onPointerCancel={endTimelineScrub}>
                <div className="ruler-spacer"/>
                <div className="ruler" style={{ width: project.duration * pxPerSecond }}>
                  {ticks.map(t => <div className="tick" key={t} style={{ left: t * pxPerSecond }}><span>{formatTime(t).slice(0,5)}</span></div>)}
                </div>
              </div>
              {project.tracks.map(track => (
                <div className="track-row" key={track.id}>
                  <div className="track-label">
                    <span className="track-icon">{track.type === 'audio' ? <Music2/> : track.type === 'text' ? <Type/> : track.type === 'image' ? <ImageIcon/> : <Film/>}</span>
                    <strong>{track.name}</strong>
                    <div className="track-actions">
                      <button onClick={() => toggleTrack(track.id,'visible')}>{track.visible ? <Eye/> : <EyeOff/>}</button>
                      <button onClick={() => toggleTrack(track.id,'locked')}>{track.locked ? <Lock/> : <Unlock/>}</button>
                    </div>
                  </div>
                  <div className="track-lane timeline-scrub-zone"
                    style={{ width: project.duration * pxPerSecond }}
                    onPointerDown={beginTimelineScrub}
                    onPointerMove={moveTimelineScrub}
                    onPointerUp={endTimelineScrub}
                    onPointerCancel={endTimelineScrub}>
                    {track.clips.map(clip => (
                      <div key={clip.id}
                        className={`timeline-clip ${TRACK_COLORS[clip.type]} ${selectedClipId===clip.id?'selected':''} ${track.locked?'locked':''}`}
                        style={{ left: clip.start * pxPerSecond, width: Math.max(16, clip.duration * pxPerSecond) }}
                        onPointerDown={e => beginClipDrag(e, clip, 'move')}
                        onPointerMove={moveClipDrag}
                        onPointerUp={endClipDrag}
                        onDoubleClick={() => { setPlayhead(clip.start); setSelectedClipId(clip.id) }}>
                        <div className="trim-handle left" onPointerDown={e => beginClipDrag(e,clip,'trim-left')}/>
                        <div className="clip-content">
                          {clip.type === 'audio' ? <Wave/> : clip.type === 'text' ? <Type size={14}/> : clip.type === 'image' ? <ImageIcon size={14}/> : <Film size={14}/>}
                          <span>{clip.text || clip.name}</span>
                        </div>
                        <div className="trim-handle right" onPointerDown={e => beginClipDrag(e,clip,'trim-right')}/>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="add-track-row"><button onClick={addTrack}><Plus size={16}/> Add Track</button></div>
              <div className="playhead" style={{ left: 190 + playhead * pxPerSecond }}>
                <div className="playhead-head"/><div className="playhead-line"/>
              </div>
            </div>
          </div>
        </section>
      </main>

      <input ref={projectInputRef} hidden type="file" accept=".json,.cjcut" onChange={importProject}/>

      {showExport && <div className="modal-backdrop" onMouseDown={() => setShowExport(false)}>
        <div className="export-modal" onMouseDown={e => e.stopPropagation()}>
          <div className="modal-title"><div><h2>Export</h2><p>Keep editing elsewhere or save the CJCut project.</p></div><button onClick={() => setShowExport(false)}>×</button></div>
          <div className="export-card active-card">
            <div className="export-icon"><Download/></div>
            <div><strong>Export editable project</strong><span>Save timeline, trims, layers and properties as JSON.</span></div>
            <button onClick={exportProject}>Export JSON</button>
          </div>
          <div className="export-card">
            <div className="export-icon"><Upload/></div>
            <div><strong>Open project</strong><span>Restore a previously saved CJCut project.</span></div>
            <button onClick={() => projectInputRef.current?.click()}>Import JSON</button>
          </div>
          <div className="render-note"><Film/><div><strong>MP4 rendering is the next isolated module.</strong><span>The V1 editor keeps the timeline/render model independent so WebCodecs, ffmpeg.wasm or server rendering can be plugged in without rewriting the UI.</span></div></div>
        </div>
      </div>}
    </div>
  )
}

function Range({label,min,max,step,value,suffix,onChange}:{label:string,min:number,max:number,step:number,value:number,suffix:string,onChange:(v:number)=>void}) {
  return <div className="range-row"><label>{label}</label><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)}/><span>{suffix}</span></div>
}

function Wave() {
  return <div className="mini-wave">{Array.from({length:24},(_,i)=><i key={i} style={{height: 5 + ((i*7)%13)}}/>)}</div>
}

export default App
