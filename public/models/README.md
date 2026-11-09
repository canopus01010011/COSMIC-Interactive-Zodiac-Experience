# Zodiac models

COSMIC ships with a built-in procedural 3D creature for all twelve signs, so it works with no binary assets.

To use your own artwork instead, drop a `.glb` here and list its file name in `manifest.json`:

```json
{ "models": ["leo.glb", "aries.glb"] }
```

Expected names: `aries.glb taurus.glb gemini.glb cancer.glb leo.glb virgo.glb libra.glb scorpio.glb sagittarius.glb capricorn.glb aquarius.glb pisces.glb`

- Any scale / origin is fine - the model is re-centred and fitted automatically.
- Animation clips in the file are played automatically.
- Materials are replaced with the glowing celestial shader (set up in `src/three/celestialMaterial.ts`),
  so the model only needs good geometry. Face the model towards +Z (the viewer).
- The particle "reassembly" samples points from the model's mesh surfaces, so keep meshes un-skinned or in bind pose.

`public/models/mediapipe/` holds the hand / face landmark models downloaded by `npm run setup:mediapipe`.
