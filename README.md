# CJCut

CJCut is a lightweight CapCut-style browser video editor built with React + TypeScript.

## V1 features

- Multi-track timeline for video, image/B-roll, audio and text
- Drag clips along the timeline
- Non-destructive left/right trimming
- Split at playhead with **Ctrl/Cmd + B**
- Delete, duplicate, copy/paste
- Play/pause with **Space**
- Frame stepping with arrow keys
- Timeline zoom and snapping
- Undo/redo
- Layer visibility/lock controls
- Properties panel for position, scale, opacity, volume and speed
- Import local videos, audio and images
- Project JSON export/import

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

> V1 focuses on the editing UX and project model. Final MP4 rendering is intentionally kept as a follow-up so the browser export pipeline can be selected independently (WebCodecs/ffmpeg.wasm or server rendering) without coupling it to the timeline implementation.
