# Changelog

## 0.1.0

First public release.

### Added

- **`<Timeline>`** — lanes with items positioned along an axis. Drag with raw
  pointer events (4px threshold, no DnD dependency); full keyboard parity via
  arrows and `alt`+arrows; optional in-place lane rename and "Add a lane";
  `readOnly` keeps selection while disabling every move; `renderItem` and
  `renderLaneHeader` for custom cards and headers.

- **Two axis kinds.** `{ kind: 'continuous', at: 0..1 }` and
  `{ kind: 'bucket', key }`, resolved by `buildModel` into one axis fraction so
  the layout has a single code path. A position whose kind does not match the
  axis resolves to the axis start rather than throwing.

- **The model, React-free** — `react-lane-timeline/model` exports `buildModel`,
  `computeLayout`, `frames`, `collisions`, `resolveAt`, `bucketAt`,
  `dropPosition`, `insertionPosition` and `tensionCurve`, each unit-tested
  directly. No React, no DOM: a server route can compute a layout.

- **Rank-packed layout.** Columns take a fixed slot in position order instead of
  scaling with distance, so clustered data stays legible. Hiding a lane re-packs
  what remains. See [`docs/ORIGIN.md`](docs/ORIGIN.md) for what that trade costs.

- **Frames and collisions as separate outputs.** Same `groupId` across two or
  more lanes at one position is a frame and shares a column; two items in one
  lane at one position is a collision and is reported as a defect.

- **Groups** — bands across the axis. With a `span`, they cover that range; with
  no `span`, they hug the columns of their own members, so a frame gets a band
  around its column for free.

- **Tension overlay** — an optional polyline over the lane beds, plotted in axis
  coordinates (not column coordinates) so it still reflects true distance, with
  the peak marked.

- **Theming by custom property.** Every public `--tl-*` hook resolves once into
  a private `--_tl-*` role; the component paints only from the roles.
  `adapters/default.css` is the bundled palette, dark with a light mode under
  `data-tl-scheme="light"`. A host themes it by writing an adapter that maps its
  own names inward.

- **A contract test suite** (107 tests) that holds the token list and the
  stylesheet to each other in both directions, and enforces that the stylesheet
  scopes every selector to `.tl-*`, never uses `position: fixed`, keeps
  `z-index` single-digit and local, measures nothing in viewport units, and
  applies offsets only inside positioned internals.

### Fixed

- **The tension overlay rendered as a spike.** `.tl-overlay` is an `<svg>`, a
  replaced element, so `inset: 0 …` did not stretch it — with `height: auto` the
  intrinsic ratio of `viewBox="0 0 1 1"` won and the overlay laid out *square*.
  On a wide board that put almost the whole curve below the clip, leaving only
  its tallest peak visible. Both dimensions are now stated explicitly, with the
  width subtracting the gutter because a percentage resolves against the
  containing block and would otherwise ignore `left`.
