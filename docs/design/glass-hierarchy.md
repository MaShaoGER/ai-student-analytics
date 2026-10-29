# Glass workspace hierarchy refinement

The active appearance uses commit `63bdf12` as its base. The optical backdrop,
WebGL refraction, glass materials and motion controls are unchanged from that
commit. The uncommitted minimal appearance was preserved in Git stash
`Preserve minimal appearance before refining committed glass UI`; a full
working-file archive and patch are also stored in the sibling rollback-backups
directory under `20261028-133418-before-glass-hierarchy`.

## Changes

- `app/glass-hierarchy.css` adjusts spacing and typography using semantic hooks.
  It does not replace materials or change the measured composer clearance.
- The conversation opening has one main heading, a compact source/status row,
  and readable suggested questions. Desktop suggestions share one row; phones
  retain a vertical list. Repeated AI slogans and decorative English labels
  were removed.
- The overview keeps metrics and the chart prominent. The supporting question
  card uses a smaller heading and shorter copy. Chart styles are available in a
  native disclosure with the current style visible in its summary.
- Suggested questions now have short topic labels and supporting question text.
  The course-comparison entry has a brighter glass edge and a “建议先看” marker.
  Pointer hover and keyboard focus reinforce the available action.
- Overview metric cards identify the current selection in text, while the
  section heading updates to the same metric. A short chart hint points to
  course detail interaction without opening a tutorial or covering the data.

## Lightweight validation — 2026-10-28

- Real isolated Next server with temporary account state and sample data.
- The workspace reports `data-optics="webgl"`, contains the optical canvas, and
  does not mount the minimal appearance.
- Desktop conversation and overview inspected; light/dark theme switching and
  opening/selecting/closing chart styles verified.
- At 390px and 320px, suggested questions remain accessible; at 320px the page
  has no horizontal overflow. A real term-trend preset returned four groups.
- Scrolling the long result at 320px leaves the transcript bottom at 468px and
  the input top at 480px; the input remains inside the viewport.
- No browser console errors observed. Model-provider responses were not tested.
- Screenshots are in `output/hierarchy-refinement/glass-*.png`.
