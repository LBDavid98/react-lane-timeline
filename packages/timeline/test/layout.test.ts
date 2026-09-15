/* ============================================================================
 * layout.test.ts — the rank-packed layout and the drop math. Ported from
 * the drafting app's `src/plot/timeline-layout.test.ts`.
 *
 * Locks: uniform packing, a collapsed lane re-packs (hidden things stop taking
 * space), a frame = one column, bands follow their columns, buckets tile the bed,
 * and a drop lands BETWEEN its new neighbours.
 * ========================================================================== */
import { describe, expect, it } from 'vitest'
import {
  bucketAt,
  buildModel,
  computeLayout,
  dropPosition,
  GAP,
  insertionPosition,
  MIN_CONTENT,
  type Axis,
  type Item,
  type TimelineData,
} from '../src/model.js'

const CONTINUOUS: Axis = { kind: 'continuous' }
const BUCKETS: Axis = {
  kind: 'buckets',
  buckets: [
    { key: 'now', label: 'Now' },
    { key: 'next', label: 'Next' },
    { key: 'later', label: 'Later' },
    { key: 'dated', label: 'Dated' },
  ],
}

const at = (id: string, laneId: string, position: number, over: Partial<Item> = {}): Item => ({
  id,
  laneId,
  title: id,
  position: { kind: 'continuous', at: position },
  ...over,
})

const inBucket = (id: string, laneId: string, key: string, over: Partial<Item> = {}): Item => ({
  id,
  laneId,
  title: id,
  position: { kind: 'bucket', key },
  ...over,
})

const model = (axis: Axis, lanes: Array<string | TimelineData['lanes'][number]>, items: Item[], groups?: TimelineData['groups']) =>
  buildModel({
    axis,
    lanes: lanes.map((l) => (typeof l === 'string' ? { id: l, label: l } : l)),
    items,
    ...(groups ? { groups } : {}),
  })

describe('computeLayout — rank-packed columns', () => {
  it('lays items in absolute order at uniform, minimal spacing', () => {
    const layout = computeLayout(model(CONTINUOUS, ['main'], [at('b1', 'main', 0.05), at('b2', 'main', 0.5), at('b3', 'main', 0.95)]))
    expect(layout.order.map((c) => c.key)).toEqual(['b1', 'b2', 'b3'])
    const xs = layout.order.map((c) => c.x)
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 6) // constant gap, not distance-scaled
    expect(layout.xOf('b1')!).toBeLessThan(layout.xOf('b2')!)
  })

  it('packs from the LEFT and never draws narrower than minContent', () => {
    const layout = computeLayout(model(CONTINUOUS, ['main'], [at('a', 'main', 0.99)]))
    expect(layout.contentWidth).toBe(MIN_CONTENT)
    expect(layout.xOf('a')!).toBeCloseTo(GAP / 2 / MIN_CONTENT, 6) // at the left edge, not at 0.99
  })

  it('reports the full board width as gutter + content', () => {
    const layout = computeLayout(model(CONTINUOUS, ['main'], [at('a', 'main', 0.5)]), { gutter: 200 })
    expect(layout.innerWidth).toBe(200 + layout.contentWidth)
  })

  it('a FRAME occupies ONE column, members leader-first, follower stepped right', () => {
    const layout = computeLayout(
      model(CONTINUOUS, ['main', 'sub'], [
        at('a', 'main', 0.2, { groupId: 's1' }),
        at('b', 'sub', 0.2, { groupId: 's1' }),
        at('c', 'main', 0.6),
      ]),
    )
    expect(layout.order).toHaveLength(2) // the frame is one unit
    const frame = layout.order.find((c) => c.key === 's1')!
    expect(frame.itemIds).toEqual(['a', 'b'])
    expect(layout.xOf('b')!).toBeGreaterThan(layout.xOf('a')!)
    // and the slot widened, so the next column clears the follower
    expect(layout.order[1]!.x - frame.x).toBeGreaterThan(GAP / layout.contentWidth)
  })

  it('collapsing a lane re-packs: fewer columns, a NARROWER board', () => {
    const many = Array.from({ length: 20 }, (_, i) => at(`m${i}`, 'main', i / 20))
    const few = [at('s0', 'sub', 0.1), at('s1', 'sub', 0.9)]
    const all = computeLayout(model(CONTINUOUS, ['main', 'sub'], [...many, ...few]))
    const collapsed = computeLayout(
      model(CONTINUOUS, [{ id: 'main', label: 'main', collapsed: true }, 'sub'], [...many, ...few]),
    )
    expect(collapsed.order).toHaveLength(2)
    expect(collapsed.contentWidth).toBeLessThan(all.contentWidth)
    expect(collapsed.xOf('m0')).toBeUndefined() // a collapsed lane's items get no x
  })

  it('still gives a collapsed lane a row, at the collapsed height', () => {
    const layout = computeLayout(
      model(CONTINUOUS, ['a', { id: 'b', label: 'b', collapsed: true }, 'c'], [at('x', 'a', 0.5)]),
      { laneHeight: 100, collapsedHeight: 30 },
    )
    expect(layout.laneRows).toEqual([
      { laneId: 'a', top: 0, height: 100 },
      { laneId: 'b', top: 100, height: 30 },
      { laneId: 'c', top: 130, height: 100 },
    ])
  })

  it('bands follow their own members when no span is declared', () => {
    const layout = computeLayout(
      model(
        CONTINUOUS,
        ['main'],
        [at('a', 'main', 0.1, { groupId: 'ch1' }), at('b', 'main', 0.2, { groupId: 'ch1' }), at('c', 'main', 0.9)],
        [{ id: 'ch1', label: 'Chapter 1' }],
      ),
    )
    const span = layout.groupSpans.get('ch1')!
    expect(span[0]).toBeCloseTo(0, 6) // starts at the bed's left edge (half a column left of column 1)
    expect(span[1]).toBeLessThan(layout.xOf('c')!) // and stops short of the un-grouped item
  })

  it('a declared span in AXIS coordinates picks the columns inside it', () => {
    const layout = computeLayout(
      model(CONTINUOUS, ['main'], [at('a', 'main', 0.1), at('b', 'main', 0.5), at('c', 'main', 0.9)], [
        { id: 'act1', label: 'Act I', span: [0, 0.6] },
      ]),
    )
    const span = layout.groupSpans.get('act1')!
    expect(span[1]).toBeGreaterThan(layout.xOf('b')!)
    expect(span[1]).toBeLessThan(layout.xOf('c')!)
  })

  it('a group with no columns gets no span at all, rather than a zero-width band', () => {
    const layout = computeLayout(
      model(CONTINUOUS, ['main'], [at('a', 'main', 0.1)], [{ id: 'ghost', label: 'Nothing here', span: [0.8, 0.9] }]),
    )
    expect(layout.groupSpans.has('ghost')).toBe(false)
  })

  it('buckets tile the bed left to right, in axis order, with no gaps', () => {
    const layout = computeLayout(
      model(BUCKETS, ['road'], [inBucket('r1', 'road', 'now'), inBucket('r2', 'road', 'later')]),
    )
    const spans = [...layout.bucketSpans]
    expect(spans.map(([key]) => key)).toEqual(['now', 'next', 'later', 'dated'])
    expect(spans[0]![1][0]).toBe(0)
    for (let i = 1; i < spans.length; i++) expect(spans[i]![1][0]).toBeCloseTo(spans[i - 1]![1][1], 9)
  })

  it('an EMPTY bucket keeps a slim band rather than collapsing to nothing', () => {
    const layout = computeLayout(model(BUCKETS, ['road'], [inBucket('r1', 'road', 'now')]), { minBucket: 40 })
    const [start, end] = layout.bucketSpans.get('next')!
    expect((end - start) * layout.contentWidth).toBeCloseTo(40, 6)
  })

  it('a bucket item lands inside its own bucket band', () => {
    const layout = computeLayout(model(BUCKETS, ['road'], [inBucket('r1', 'road', 'later')]))
    const [start, end] = layout.bucketSpans.get('later')!
    const x = layout.xOf('r1')!
    expect(x).toBeGreaterThanOrEqual(start)
    expect(x).toBeLessThanOrEqual(end)
  })

  it('honours a custom gap and reports the options it used', () => {
    const layout = computeLayout(model(CONTINUOUS, ['main'], Array.from({ length: 10 }, (_, i) => at(`i${i}`, 'main', i / 10))), { gap: 200 })
    expect(layout.opts.gap).toBe(200)
    expect(layout.contentWidth).toBe(2000)
  })

  it('lays out empty data without throwing', () => {
    const layout = computeLayout(model(CONTINUOUS, ['main'], []))
    expect(layout.order).toEqual([])
    expect(layout.contentWidth).toBe(MIN_CONTENT)
    expect(layout.laneRows).toHaveLength(1)
  })
})

describe('insertionPosition — absolute-order drop', () => {
  const layout = computeLayout(
    buildModel({
      axis: CONTINUOUS,
      lanes: [{ id: 'main', label: 'main' }],
      items: [at('b1', 'main', 0.1), at('b2', 'main', 0.5), at('b3', 'main', 0.9)],
    }),
  )

  it('dropping BETWEEN two items writes the MIDPOINT of their positions', () => {
    const [c1, c2] = [layout.order[0]!.x, layout.order[1]!.x]
    const position = insertionPosition(layout.order, (c1 + c2) / 2 + 0.001, ['bX'])
    expect(position).toEqual({ kind: 'continuous', at: 0.3 }) // midpoint of 0.1 and 0.5
  })

  it('dropping at the far right midpoints against 1', () => {
    expect(insertionPosition(layout.order, 0.999, ['bX'])).toEqual({ kind: 'continuous', at: 0.95 })
  })

  it('dropping at the far left midpoints against 0', () => {
    expect(insertionPosition(layout.order, 0, ['bX'])).toEqual({ kind: 'continuous', at: 0.05 })
  })

  it('excludes the dragged item from its own neighbour math', () => {
    // dragging b2 to the far right lands after b3 — not between b1 and b3 with itself still counted
    expect(insertionPosition(layout.order, 0.999, ['b2']).at).toBeGreaterThan(0.9)
  })

  it('excludes every member of a dragged FRAME', () => {
    const framed = computeLayout(
      buildModel({
        axis: CONTINUOUS,
        lanes: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }],
        items: [
          at('f1', 'a', 0.4, { groupId: 'g' }),
          at('f2', 'b', 0.4, { groupId: 'g' }),
          at('other', 'a', 0.8),
        ],
      }),
    )
    const position = insertionPosition(framed.order, 0.999, ['f1', 'f2'])
    expect(position.at).toBeGreaterThan(0.8) // past `other`, not between the frame and it
  })

  it('an empty board still yields the middle', () => {
    expect(insertionPosition([], 0.5, [])).toEqual({ kind: 'continuous', at: 0.5 })
  })
})

describe('bucketAt — a bucket-axis drop', () => {
  const built = model(BUCKETS, ['road'], [inBucket('r1', 'road', 'now'), inBucket('r2', 'road', 'dated')])
  const layout = computeLayout(built)

  it('maps a fraction to the band it lands in', () => {
    const [start, end] = layout.bucketSpans.get('later')!
    expect(bucketAt(layout, (start + end) / 2)).toEqual({ kind: 'bucket', key: 'later' })
  })

  it('maps the left edge to the first bucket and the right edge to the last', () => {
    expect(bucketAt(layout, 0)).toEqual({ kind: 'bucket', key: 'now' })
    expect(bucketAt(layout, 1)).toEqual({ kind: 'bucket', key: 'dated' })
  })

  it('returns null only when the axis has no buckets', () => {
    expect(bucketAt(computeLayout(model(CONTINUOUS, ['main'], [])), 0.5)).toBeNull()
  })
})

describe('dropPosition — one entry point, either axis', () => {
  it('gives a bucket position on a bucket axis', () => {
    const built = model(BUCKETS, ['road'], [inBucket('r1', 'road', 'now')])
    const layout = computeLayout(built)
    expect(dropPosition(built, layout, 0.99, ['r1']).kind).toBe('bucket')
  })

  it('gives a continuous position on a continuous axis', () => {
    const built = model(CONTINUOUS, ['main'], [at('a', 'main', 0.2)])
    const layout = computeLayout(built)
    expect(dropPosition(built, layout, 0.99, ['a']).kind).toBe('continuous')
  })
})
