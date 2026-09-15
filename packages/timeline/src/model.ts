/* ============================================================================
 * model.ts — the lanes + sequence view model. PURE, DOM-free, React-free:
 * `<Timeline>` renders it, but every number here can be unit-tested directly.
 *
 * Ported from a drafting app's two pure plot modules
 * (both pure and unit-tested there) with the story types lifted out. The shape
 * the drafting app discovered, generically:
 *
 *   • An item's position is EITHER continuous (`{kind:'continuous', at: 0..1}`,
 *     a drafting app's beat distance) OR a discrete bucket (`{kind:'bucket', key}`,
 *     a roadmap tool's now|next|later|dated). `buildModel` resolves either into one
 *     axis fraction `at ∈ [0,1]`, so everything downstream has one number.
 *
 *   • FRAMES are cross-lane coincidence: items sharing a `groupId` in ≥2 lanes
 *     AT THE SAME POSITION. They share one column (the drafting app's shared scene).
 *     Two items in the SAME lane at the same position are never a frame — that
 *     is a COLLISION, a defect the drag layer resolves. This is the one rule
 *     that app's comments call "the overlap LAW", and it is why `collisions`
 *     and `frames` are separate outputs rather than one "overlaps" list.
 *
 *   • The layout is RANK-PACKED, not distance-scaled: each column takes one
 *     fixed GAP-wide slot in position order, so 79 items do not become 13000px
 *     of mostly-empty scroll, and hiding a lane re-packs what is left. Absolute
 *     order still comes from `at` — the backend's source of truth.
 * ========================================================================== */

// ---------------------------------------------------------------------------
// The data contract
// ---------------------------------------------------------------------------

export interface Lane {
  id: string
  label: string
  /** Free-form host classification (e.g. main/character-arc/subplot). Used only for styling. */
  kind?: string
  /** A per-lane accent, painted as the lane's rail. Any CSS color. */
  color?: string
  /** Collapsed lanes keep their header and their order but draw no items. */
  collapsed?: boolean
}

/** A fraction of the whole axis, 0..1 (a drafting app's beat distance). */
export interface ContinuousPosition {
  kind: 'continuous'
  at: number
}

/** A named bucket on a discrete axis (a roadmap tool's now | next | later | dated). */
export interface BucketPosition {
  kind: 'bucket'
  key: string
}

/** Where an item sits on the axis: a continuous fraction, or a named bucket. */
export type Position = ContinuousPosition | BucketPosition

export interface Item {
  id: string
  laneId: string
  position: Position
  title: string
  subtitle?: string
  /** Items sharing a groupId across ≥2 lanes at one position form a FRAME (one column). */
  groupId?: string
  /** Author-set dramatic weight 0..1, for the tension overlay. */
  tension?: number
  /** Opaque host references (a doc id, a vault id) — carried, never interpreted. */
  refs?: string[]
  meta?: Record<string, unknown>
}

export type Axis =
  | { kind: 'continuous' }
  | { kind: 'buckets'; buckets: Array<{ key: string; label: string }> }

/**
 * A band drawn across the axis (chapter/act containers, in the drafting case). `span` is in
 * AXIS coordinates: fractions 0..1 on a continuous axis, bucket INDICES on a bucket
 * axis. With no `span`, the band hugs the columns of the items whose `groupId` is
 * this group's id — so a frame gets a band around its own column for free.
 */
export interface Group {
  id: string
  label: string
  span?: [number, number]
}

export interface TimelineData {
  axis: Axis
  lanes: Lane[]
  items: Item[]
  groups?: Group[]
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** An item with its axis position resolved. */
export interface PositionedItem {
  item: Item
  laneId: string
  /** Resolved axis fraction [0,1] — the absolute-order key. Never shown as a number. */
  at: number
  /** Bucket index, when the axis is bucketed and the position resolved to one. */
  bucket?: number
  /** Present ⇒ this item is a member of a cross-lane frame; the value is the frame's groupId. */
  frameId?: string
}

export interface ModelLane extends Lane {
  /** This lane's items, ordered by `at`. */
  items: PositionedItem[]
}

/** A cross-lane frame: one group realized in ≥2 lanes at one position. */
export interface Frame {
  groupId: string
  /** Representative axis fraction — the minimum member `at` (the frame anchors at its earliest item). */
  at: number
  itemIds: string[]
  laneIds: string[]
}

export interface TimelineModel {
  axis: Axis
  lanes: ModelLane[]
  /** Every item, ordered by `at` (ties broken by id, so the order is stable). */
  items: PositionedItem[]
  /** SHARED frames only. A group living in one lane is not a frame. */
  frames: Frame[]
  groups: Group[]
}

/** A point on the tension curve — x = axis fraction [0,1], y = tension [0,1]. */
export interface TensionPoint {
  x: number
  y: number
  /** The item this point came from, so a renderer can put the point at the item's COLUMN. */
  itemId: string
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/** Items within this much of each other count as the same position (frames, collisions). */
export const EPSILON = 0.02

/**
 * Same position, within `epsilon`. The 1e-9 slack is not decoration: positions arrive
 * as float fractions, and 0.52 - 0.5 evaluates to 0.020000000000000018, so a bare
 * `<= epsilon` would call two items at the default epsilon apart "not the same
 * position" for a reason no caller could ever see.
 */
const near = (a: number, b: number, epsilon: number): boolean => Math.abs(a - b) <= epsilon + 1e-9

/**
 * Resolve one position into an axis fraction. Priority, mirroring the drafting app's
 * `beatDistance` fallback chain — a placement the axis understands first, then a
 * sensible reading of the other kind, then an even spread for "no placement yet":
 *
 *   continuous axis · continuous position → clamp01(at)
 *   continuous axis · bucket position     → no placement here: even ord-spread
 *   bucket axis     · bucket position     → the bucket's centre, (i + 0.5) / n
 *   bucket axis     · continuous position → the bucket `at` falls in, then its centre
 *   bucket axis     · unknown bucket key  → no placement: even ord-spread, no bucket
 *
 * `index`/`count` are the item's ordinal within its own lane, used only by the spread.
 */
export function resolveAt(
  position: Position,
  axis: Axis,
  index = 0,
  count = 1,
): { at: number; bucket?: number } {
  const spread = (): { at: number } => ({ at: count <= 1 ? 0.5 : clamp01(index / (count - 1)) })

  if (axis.kind === 'continuous') {
    if (position.kind === 'continuous' && Number.isFinite(position.at)) return { at: clamp01(position.at) }
    return spread()
  }

  const n = axis.buckets.length
  if (n === 0) return spread()
  const centre = (i: number): number => (i + 0.5) / n

  if (position.kind === 'bucket') {
    const i = axis.buckets.findIndex((b) => b.key === position.key)
    if (i < 0) return spread()
    return { at: centre(i), bucket: i }
  }
  if (!Number.isFinite(position.at)) return spread()
  const i = Math.min(n - 1, Math.max(0, Math.floor(clamp01(position.at) * n)))
  return { at: centre(i), bucket: i }
}

/**
 * The cross-lane frames: groups realized in ≥2 distinct lanes AT ONE POSITION
 * (within `epsilon`). Pure, display-only, no inference. A group in one lane is not
 * a frame; nor is a group whose members are spread down the axis (an "Act I" band
 * crossing every lane is a BAND, not a frame) — that spread check is the one thing
 * this adds to the drafting app's `sharedFrames`, which got it from the scene id for free.
 */
export function frames(items: PositionedItem[], epsilon = EPSILON): Frame[] {
  const byGroup = new Map<string, PositionedItem[]>()
  for (const p of items) {
    if (!p.item.groupId) continue
    const arr = byGroup.get(p.item.groupId) ?? []
    arr.push(p)
    byGroup.set(p.item.groupId, arr)
  }
  const out: Frame[] = []
  for (const [groupId, members] of byGroup) {
    const laneIds = [...new Set(members.map((p) => p.laneId))]
    if (laneIds.length < 2) continue // a frame is cross-lane coincidence
    const ats = members.map((p) => p.at)
    if (!near(Math.max(...ats), Math.min(...ats), epsilon)) continue // spread out ⇒ a band, not a frame
    out.push({ groupId, at: Math.min(...ats), itemIds: members.map((p) => p.item.id), laneIds })
  }
  return out.sort((a, b) => a.at - b.at || (a.groupId < b.groupId ? -1 : 1))
}

/**
 * Same-lane position COLLISIONS — pairs of items on ONE lane sitting within `epsilon`
 * of each other that do NOT share a group. These are the overlap-LAW defects (in-lane
 * piling); the host resolves them by moving one. Cross-lane coincidence is a legitimate
 * frame, so this only ever compares within one lane.
 */
export function collisions(lane: ModelLane, epsilon = EPSILON): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const items = lane.items
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!
      const b = items[j]!
      if (!near(a.at, b.at, epsilon)) continue
      if (a.item.groupId && a.item.groupId === b.item.groupId) continue // intentional pairing
      out.push([a.item.id, b.item.id])
    }
  }
  return out
}

/**
 * The tension LINE-GRAPH points. Tension is the author's when set (`item.tension`),
 * and otherwise DERIVED so the curve is never flat on fresh data: it escalates toward
 * a late climax (~0.85 of the way through) and releases after it — the drafting app's
 * `escalate`, unchanged, minus the story-specific arc-stage table.
 */
export function tensionCurve(items: PositionedItem[]): TensionPoint[] {
  const escalate = (d: number): number =>
    d <= 0.85 ? 0.15 + (d / 0.85) * 0.78 : 0.93 - ((d - 0.85) / 0.15) * 0.55
  return items
    .map((p): TensionPoint => ({
      x: p.at,
      itemId: p.item.id,
      y: clamp01(
        typeof p.item.tension === 'number' && Number.isFinite(p.item.tension)
          ? p.item.tension
          : escalate(p.at),
      ),
    }))
    .sort((a, b) => a.x - b.x)
}

/**
 * Build the model: lanes in DECLARED order (the host owns lane order), each lane's
 * items ordered by resolved position, plus the cross-lane frames and the groups.
 *
 * An item whose `laneId` names no declared lane is dropped — a lane list is the
 * host's statement of what exists, and inventing a lane from an item would make a
 * typo look like a feature.
 */
export function buildModel(data: TimelineData): TimelineModel {
  const byLane = new Map<string, Item[]>()
  for (const lane of data.lanes) byLane.set(lane.id, [])
  for (const item of data.items) byLane.get(item.laneId)?.push(item)

  const positioned: PositionedItem[] = []
  const lanes: ModelLane[] = data.lanes.map((lane) => {
    const raw = byLane.get(lane.id) ?? []
    const items = raw
      .map((item, index): PositionedItem => ({
        item,
        laneId: lane.id,
        ...resolveAt(item.position, data.axis, index, raw.length),
      }))
      .sort((a, b) => a.at - b.at || (a.item.id < b.item.id ? -1 : 1))
    positioned.push(...items)
    return { ...lane, items }
  })

  const found = frames(positioned)
  const frameOf = new Map<string, string>()
  for (const f of found) for (const id of f.itemIds) frameOf.set(id, f.groupId)
  for (const p of positioned) {
    const frameId = frameOf.get(p.item.id)
    if (frameId) p.frameId = frameId
  }

  return {
    axis: data.axis,
    lanes,
    items: positioned.slice().sort((a, b) => a.at - b.at || (a.item.id < b.item.id ? -1 : 1)),
    frames: found,
    groups: data.groups ?? [],
  }
}

// ---------------------------------------------------------------------------
// The layout — rank-packed columns
// ---------------------------------------------------------------------------

/** The lane-header gutter, in px. Matches `--tl-gutter`'s default. */
export const GUTTER = 176
/** px per column — a card plus a hair of air, so nothing overlaps in a lane. */
export const GAP = 150
/** px a bucket with no items still takes, so its band never collapses to nothing. */
export const MIN_BUCKET = 44
/** A frame's follower steps this fraction of a column right of the leader. */
export const FOLLOWER = 0.36
/** The bed never draws narrower than this: a handful of items stays left-packed, not stretched. */
export const MIN_CONTENT = 820
/** Default lane row height, in px. Matches `--tl-lane-height`'s default. */
export const LANE_HEIGHT = 92
/** Default collapsed lane row height, in px. */
export const LANE_HEIGHT_COLLAPSED = 34

export interface LayoutOptions {
  gap?: number
  gutter?: number
  minContent?: number
  minBucket?: number
  follower?: number
  laneHeight?: number
  collapsedHeight?: number
}

/** One packed column: a solo item, or a frame's members sharing the slot. */
export interface LayoutColumn {
  /** The frame's groupId, or the solo item's id. */
  key: string
  /** The column's anchor axis fraction (min member `at`) — the absolute-order key. */
  at: number
  /** The column centre as a render fraction [0,1] across the bed. */
  x: number
  /** Member item ids, leader first. */
  itemIds: string[]
  /** Bucket index this column packed into, on a bucket axis. */
  bucket?: number
}

export interface LaneRow {
  laneId: string
  /** px from the top of the lane stack. Advisory: the component lets CSS drive height. */
  top: number
  height: number
}

export interface TimelineLayout {
  /** itemId → render x fraction [0,1] across the bed. Unknown id ⇒ undefined. */
  xOf: (itemId: string) => number | undefined
  /** The lane stack, in order, as px offsets (see `LaneRow.top`). */
  laneRows: LaneRow[]
  /** groupId → [start,end] render fractions. A group with no columns gets no span. */
  groupSpans: Map<string, [number, number]>
  /** bucket key → [start,end] render fractions, in axis order. Empty on a continuous axis. */
  bucketSpans: Map<string, [number, number]>
  /** The bed width in px. `innerWidth` = gutter + contentWidth. */
  contentWidth: number
  innerWidth: number
  /** Visible columns in COLUMN order (== reading order), for insertion math on drop. */
  order: LayoutColumn[]
  /** The options actually used, resolved. */
  opts: Required<LayoutOptions>
}

/**
 * Rank-pack the model into columns. Each column takes one fixed `gap`-wide slot in
 * absolute-position order; a frame is ONE column whose followers step right and whose
 * slot widens to clear them. On a bucket axis, columns pack into their bucket in axis
 * order and an empty bucket keeps a slim band — which is exactly how the drafting app binned
 * into chapters, with buckets standing in for leaves.
 *
 * A collapsed lane keeps its row but contributes no columns, so collapsing re-packs the
 * board narrower (the drafting app's "hiding a lane re-packs what's left").
 */
export function computeLayout(model: TimelineModel, options: LayoutOptions = {}): TimelineLayout {
  const opts: Required<LayoutOptions> = {
    gap: options.gap ?? GAP,
    gutter: options.gutter ?? GUTTER,
    minContent: options.minContent ?? MIN_CONTENT,
    minBucket: options.minBucket ?? MIN_BUCKET,
    follower: options.follower ?? FOLLOWER,
    laneHeight: options.laneHeight ?? LANE_HEIGHT,
    collapsedHeight: options.collapsedHeight ?? LANE_HEIGHT_COLLAPSED,
  }

  const hidden = new Set(model.lanes.filter((l) => l.collapsed).map((l) => l.id))
  const visible = model.items.filter((p) => !hidden.has(p.laneId))

  // Group the visible items into COLUMNS: a frame's members share one, everything else is solo.
  const frameOf = new Map<string, Frame>()
  for (const f of model.frames) for (const id of f.itemIds) frameOf.set(id, f)
  const byKey = new Map<string, PositionedItem[]>()
  for (const p of visible) {
    const key = frameOf.get(p.item.id)?.groupId ?? p.item.id
    const arr = byKey.get(key) ?? []
    arr.push(p)
    byKey.set(key, arr)
  }
  interface Unit {
    key: string
    at: number
    bucket?: number
    members: PositionedItem[]
  }
  const units: Unit[] = [...byKey].map(([key, members]) => {
    const ordered = members.slice().sort((a, b) => a.at - b.at || (a.item.id < b.item.id ? -1 : 1))
    const lead = ordered[0]!
    return {
      key,
      at: Math.min(...ordered.map((m) => m.at)),
      ...(lead.bucket !== undefined ? { bucket: lead.bucket } : {}),
      members: ordered,
    }
  })

  const xPx = new Map<string, number>()
  const order: LayoutColumn[] = []
  const bucketSpanPx = new Map<string, [number, number]>()
  let cursor = 0

  const place = (group: Unit[]): void => {
    group.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1))
    for (const u of group) {
      const centre = cursor + opts.gap / 2
      u.members.forEach((m, r) => xPx.set(m.item.id, centre + r * opts.follower * opts.gap))
      order.push({
        key: u.key,
        at: u.at,
        x: centre,
        itemIds: u.members.map((m) => m.item.id),
        ...(u.bucket !== undefined ? { bucket: u.bucket } : {}),
      })
      // Widen the slot so a frame's followers clear the next column.
      cursor += opts.gap + Math.max(0, u.members.length - 1) * opts.follower * opts.gap
    }
  }

  if (model.axis.kind === 'buckets' && model.axis.buckets.length > 0) {
    const buckets = model.axis.buckets
    const byBucket = new Map<number, Unit[]>()
    for (const u of units) {
      const i = u.bucket ?? Math.min(buckets.length - 1, Math.max(0, Math.floor(u.at * buckets.length)))
      const arr = byBucket.get(i) ?? []
      arr.push(u)
      byBucket.set(i, arr)
    }
    buckets.forEach((bucket, i) => {
      const start = cursor
      const group = byBucket.get(i) ?? []
      if (group.length === 0) cursor += opts.minBucket
      else place(group)
      bucketSpanPx.set(bucket.key, [start, cursor])
    })
  } else {
    place(units.slice())
  }

  const contentWidth = Math.max(opts.minContent, cursor)
  const frac = (px: number): number => px / contentWidth
  const x = new Map<string, number>()
  for (const [id, px] of xPx) x.set(id, frac(px))
  for (const u of order) u.x = frac(u.x)
  const bucketSpans = new Map<string, [number, number]>()
  for (const [key, [s, e]] of bucketSpanPx) bucketSpans.set(key, [frac(s), frac(e)])

  // Group bands. An explicit span is in AXIS coordinates (fractions, or bucket indices);
  // without one the band hugs the columns of its own members.
  const half = frac(opts.gap / 2)
  const groupSpans = new Map<string, [number, number]>()
  for (const group of model.groups) {
    const cols = group.span
      ? order.filter((c) => inSpan(c, group.span!, model.axis))
      : order.filter((c) => c.itemIds.some((id) => memberOf(model, id, group.id)))
    if (cols.length === 0) continue
    const xs = cols.map((c) => c.x)
    groupSpans.set(group.id, [
      Math.max(0, Math.min(...xs) - half),
      Math.min(1, Math.max(...xs) + half),
    ])
  }

  let top = 0
  const laneRows: LaneRow[] = model.lanes.map((lane) => {
    const height = lane.collapsed ? opts.collapsedHeight : opts.laneHeight
    const row: LaneRow = { laneId: lane.id, top, height }
    top += height
    return row
  })

  return {
    xOf: (itemId: string) => x.get(itemId),
    laneRows,
    groupSpans,
    bucketSpans,
    contentWidth,
    innerWidth: opts.gutter + contentWidth,
    order,
    opts,
  }
}

const memberOf = (model: TimelineModel, itemId: string, groupId: string): boolean =>
  model.items.some((p) => p.item.id === itemId && p.item.groupId === groupId)

/** Is this column inside an explicit group span? Fractions on a continuous axis, bucket indices otherwise. */
function inSpan(column: LayoutColumn, span: [number, number], axis: Axis): boolean {
  const [from, to] = span
  const value = axis.kind === 'buckets' ? (column.bucket ?? -1) : column.at
  return value >= Math.min(from, to) && value <= Math.max(from, to)
}

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

/**
 * Absolute-order INSERTION for a CONTINUOUS drop: an item dropped at render fraction
 * `frac` takes the slot there and everything after it slides forward. Returns the
 * position to write — the MIDPOINT between its new neighbours in column order — so the
 * item lands exactly between them and the rank layout re-packs the rest. Dropping past
 * the ends midpoints against 0 and 1. `excludeIds` are the dragged item's own ids, kept
 * out of their own neighbour math (the drafting app's `insertionDistance`, verbatim).
 */
export function insertionPosition(
  order: LayoutColumn[],
  frac: number,
  excludeIds: string[],
): ContinuousPosition {
  const exclude = new Set(excludeIds)
  const others = order.filter((c) => !c.itemIds.some((id) => exclude.has(id)))
  const index = others.filter((c) => c.x < frac).length // columns whose centre sits left of the drop
  const before = others[index - 1]
  const after = others[index]
  const lo = before ? before.at : 0
  const hi = after ? after.at : 1
  return { kind: 'continuous', at: Math.max(0, Math.min(1, (lo + hi) / 2)) }
}

/**
 * The bucket a BUCKET-axis drop landed in, by render fraction. Buckets tile the bed
 * left to right, so the drop is whichever band contains `frac`; past the last band's
 * end (the bed's minimum-width slack) it is the last bucket. `null` only when the axis
 * has no buckets at all.
 */
export function bucketAt(layout: TimelineLayout, frac: number): BucketPosition | null {
  const spans = [...layout.bucketSpans]
  if (spans.length === 0) return null
  for (const [key, [start, end]] of spans) {
    if (frac >= start && frac < end) return { kind: 'bucket', key }
  }
  const [firstKey] = spans[0]!
  if (frac < 0) return { kind: 'bucket', key: firstKey }
  const [lastKey] = spans[spans.length - 1]!
  return { kind: 'bucket', key: lastKey }
}

/** Resolve a drop on either axis kind into the position to write. */
export function dropPosition(
  model: TimelineModel,
  layout: TimelineLayout,
  frac: number,
  excludeIds: string[],
): Position {
  if (model.axis.kind === 'buckets') {
    return bucketAt(layout, frac) ?? insertionPosition(layout.order, frac, excludeIds)
  }
  return insertionPosition(layout.order, frac, excludeIds)
}
