# COSMIC

COSMIC is a browser-based camera experience built with React, MediaPipe, and Three.js. It tracks your hands and face to add
interactive effects, including a crown, glowing stars, and animated zodiac creatures.

The app does not have a backend. Camera frames and tracking run in the browser, on your device. MediaPipe files may be
downloaded during setup or fetched from Google's public servers if they are not available locally.

## What you can do

- Hold one finger still to place a star.
- Bring two fingers close together to draw.
- Raise both hands, open your palms, and hold them apart to turn your constellation into a zodiac creature.
- Move one hand to move the creature. Use both hands to resize or rotate it.
- Trace a C to show Canopus, or trace a heart to play the heart animation.
- Wear a crystal crown that follows your head.

## Run locally

You need Node.js 20.19 or newer and a modern browser with a camera and WebGL support.

```bash
npm install
npm run dev
```

Open the local address printed in the terminal, usually `http://localhost:5173`, and allow camera access.

If setup could not download the MediaPipe files, try again with:

```bash
npm run setup:mediapipe
```

## Open it on a phone

For a quick test, deploy the contents of the `dist` folder to a static host such as Netlify. First create the production
files:

```bash
npm run build
```

Upload the generated `dist` folder and open the HTTPS link from your phone. Allow camera access when the browser asks.
The development server's local network address uses HTTP, which usually cannot access the camera on a phone.

## Useful commands

```bash
npm run build:check
npm test
npm run preview
```

`build:check` runs TypeScript checks and creates the production build. `test` runs the automated test suite.
`preview` serves the production build locally after you have run `npm run build`.

## Try the mock tracker

Add `?mock=1` to the local address, for example `http://localhost:5173/?mock=1`. The mock tracker lets you test
gestures with a mouse and keyboard instead of tracking hand movements. The app still starts the camera.

| Input                            | Action                                         |
| -------------------------------- | ---------------------------------------------- |
| Mouse                            | Move the mock hand                             |
| Hold `1`                         | Use the one-finger pose                        |
| Hold `2`                         | Use the drawing pose                           |
| `3`                              | Use a peace sign                               |
| `B` and mouse wheel              | Add a second mock hand and change its distance |
| `K`                              | Raise both open palms apart to finish          |
| Draw a C or heart with the mouse | Play the matching animation                    |
| `Alt` and mouse wheel            | Raise or lower the second mock hand            |

## Project layout

```text
src/
  app/            App setup, state, and event handling
  camera/         Camera access and error handling
  components/     Start screen, controls, and settings
  constellation/  Stars, strokes, and constellation data
  effects/        Camera overlays, particles, and animations
  gestures/       Hand gesture detection and smoothing
  three/          3D scene, zodiac models, and particle effects
  vision/         MediaPipe integration and mock tracker
tests/            Automated tests
public/models/    Optional zodiac model files
```

## Zodiac models

COSMIC includes procedural models for all twelve signs, so it works without extra model assets. To use a custom model,
add a `<sign>.glb` file to `public/models/` and list its filename in `public/models/manifest.json`.

## Privacy

Camera frames are processed in the browser and are not uploaded by the app. MediaPipe model files may be fetched from
Google's public servers when they are not available locally. The app does not record or store camera video.
