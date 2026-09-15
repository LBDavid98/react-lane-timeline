/* ============================================================================
 * model.test.ts — the view model. Ported from the drafting app's `src/plot/timeline.test.ts`
 * with the Beat/Doc types lifted out; the cases it locks are the same ones, plus the
 * bucket axis the drafting app never had.
 * ========================================================================== */
import { describe, expect, it } from 'vitest'
import {
  buildModel,
  collisions,
  frames,
  resolveAt,
  tensionCurve,
  type Axis,
  type Item,
  type ModelLane,
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

const data = (axis: Axis, lanes: string[], items: Item[], groups?: TimelineData['groups']): TimelineData => ({
  axis,
  lanes: lanes.map((id) => ({ id, label: id })),
  items,
  ...(groups ? { groups } : {}),
})

describe('resolveAt — one position, two kinds, one number out', () => {
  it('takes a continuous position on a continuous axis as-is', () => {
    expect(resolveAt({ kind: 'continuous', at: 0.42 }, CONTINUOUS)).toEqual({ at: 0.42 })
  })

  it('clamps an out-of-range continuous position to [0,1]', () => {
    expect(resolveAt({ kind: 'continuous', at: 1.5 }, CONTINUOUS).at).toBe(1)
    expect(resolveAt({ kind: 'continuous', at: -1 }, CONTINUOUS).at).toBe(0)
  })

  it('resolves a bucket to its CENTRE, so four buckets read 0.125 … 0.875', () => {
    expect(resolveAt({ kind: 'bucket', key: 'now' }, BUCKETS)).toEqual({ at: 0.125, bucket: 0 })
    expect(resolveAt({ kind: 'bucket', key: 'dated' }, BUCKETS)).toEqual({ at: 0.875, bucket: 3 })
  })

  it('reads a CONTINUOUS position on a bucket axis as the bucket it falls in', () => {
    expect(resolveAt({ kind: 'continuous', at: 0.3 }, BUCKETS)).toEqual({ at: 0.375, bucket: 1 })
    expect(resolveAt({ kind: 'continuous', at: 1 }, BUCKETS).bucket).toBe(3) // the end is the last bucket, not a fifth
  })

  it('falls back to an even ord-spread when the axis cannot place the position', () => {
    // a bucket position on a continuous axis, and an unknown bucket key: no placement yet
    expect(resolveAt({ kind: 'bucket', key: 'now' }, CONTINUOUS, 1, 3)).toEqual({ at: 0.5 })
    expect(resolveAt({ kind: 'bucket', key: 'nope' }, BUCKETS, 0, 3)).toEqual({ at: 0 })
    expect(resolveAt({ kind: 'bucket', key: 'nope' }, BUCKETS, 2, 3)).toEqual({ at: 1 })
    expect(resolveAt({ kind: 'bucket', key: 'nope' }, BUCKETS, 0, 1)).toEqual({ at: 0.5 }) // alone reads mid-lane
  })
})

describe('buildModel', () => {
  it('keeps the DECLARED lane order and orders each lane by position', () => {
    const model = buildModel(
      data(CONTINUOUS, ['main', 'sub'], [at('b', 'main', 0.9), at('a', 'main', 0.1), at('s', 'sub', 0.5)]),
    )
    expect(model.lanes.map((l) => l.id)).toEqual(['main', 'sub'])
    expect(model.lanes[0]!.items.map((p) => p.item.id)).toEqual(['a', 'b'])
  })

  it('sorts all items by position, breaking ties by id so the order is stable', () => {
    const model = buildModel(data(CONTINUOUS, ['a', 'b'], [at('z', 'a', 0.5), at('m', 'b', 0.5), at('e', 'a', 0.1)]))
    expect(model.items.map((p) => p.item.id)).toEqual(['e', 'm', 'z'])
  })

  it('drops an item whose lane was never declared, rather than inventing the lane', () => {
    const model = buildModel(data(CONTINUOUS, ['main'], [at('a', 'main', 0.1), at('ghost', 'typo', 0.5)]))
    expect(model.items.map((p) => p.item.id)).toEqual(['a'])
  })

  it('lays a bucket axis out by bucket centre, and records the bucket index', () => {
    const model = buildModel(
      data(BUCKETS, ['roadmap'], [inBucket('r2', 'roadmap', 'later'), inBucket('r1', 'roadmap', 'now')]),
    )
    expect(model.lanes[0]!.items.map((p) => p.item.id)).toEqual(['r1', 'r2'])
    expect(model.lanes[0]!.items.map((p) => p.bucket)).toEqual([0, 2])
  })

  it('carries lane presentation (kind, color, collapsed) through untouched', () => {
    const model = buildModel({
      axis: CONTINUOUS,
      lanes: [{ id: 'main', label: 'Main', kind: 'spine', color: '#f00', collapsed: true }],
      items: [at('a', 'main', 0.5)],
    })
    expect(model.lanes[0]).toMatchObject({ kind: 'spine', color: '#f00', collapsed: true })
  })

  it('tags frame members with the frameId and leaves everyone else alone', () => {
    const model = buildModel(
      data(CONTINUOUS, ['main', 'arc'], [
        at('m1', 'main', 0.5, { groupId: 'g1' }),
        at('a1', 'arc', 0.51, { groupId: 'g1' }),
        at('m2', 'main', 0.9),
      ]),
    )
    const byId = new Map(model.items.map((p) => [p.item.id, p]))
    expect(byId.get('m1')!.frameId).toBe('g1')
    expect(byId.get('a1')!.frameId).toBe('g1')
    expect(byId.get('m2')!.frameId).toBeUndefined()
  })

  it('exposes declared groups, and an empty list when there are none', () => {
    expect(buildModel(data(CONTINUOUS, ['a'], [])).groups).toEqual([])
    const withGroups = buildModel(data(CONTINUOUS, ['a'], [], [{ id: 'act1', label: 'Act I', span: [0, 0.33] }]))
    expect(withGroups.groups[0]!.label).toBe('Act I')
  })
})

describe('frames — cross-lane coincidence only', () => {
  it('makes a frame from one group in ≥2 lanes, anchored at the earliest member', () => {
    const model = buildModel(
      data(CONTINUOUS, ['main', 'arc'], [
        at('m1', 'main', 0.52, { groupId: 'g1' }),
        at('a1', 'arc', 0.5, { groupId: 'g1' }),
      ]),
    )
    expect(model.frames).toHaveLength(1)
    expect(model.frames[0]!.groupId).toBe('g1')
    expect(model.frames[0]!.at).toBe(0.5)
    expect(model.frames[0]!.laneIds.slice().sort()).toEqual(['arc', 'main'])
  })

  it('does NOT frame two items of the SAME lane sharing a group — that is not cross-lane', () => {
    const model = buildModel(
      data(CONTINUOUS, ['main'], [
        at('m1', 'main', 0.5, { groupId: 'g1' }),
        at('m2', 'main', 0.5, { groupId: 'g1' }),
      ]),
    )
    expect(model.frames).toEqual([])
  })

  it('does NOT frame a group SPREAD down the axis — an "Act I" band is not a coincidence', () => {
    const model = buildModel(
      data(CONTINUOUS, ['main', 'arc'], [
        at('m1', 'main', 0.1, { groupId: 'act1' }),
        at('a1', 'arc', 0.3, { groupId: 'act1' }),
      ]),
    )
    expect(model.frames).toEqual([])
  })

  it('frames items across lanes in the SAME bucket, since a bucket resolves to one centre', () => {
    const model = buildModel(
      data(BUCKETS, ['a', 'b'], [
        inBucket('x', 'a', 'next', { groupId: 'ship' }),
        inBucket('y', 'b', 'next', { groupId: 'ship' }),
      ]),
    )
    expect(model.frames.map((f) => f.groupId)).toEqual(['ship'])
  })

  it('orders frames by position', () => {
    const built = frames([
      { item: at('a', 'l1', 0.8, { groupId: 'late' }), laneId: 'l1', at: 0.8 },
      { item: at('b', 'l2', 0.8, { groupId: 'late' }), laneId: 'l2', at: 0.8 },
      { item: at('c', 'l1', 0.2, { groupId: 'early' }), laneId: 'l1', at: 0.2 },
      { item: at('d', 'l2', 0.2, { groupId: 'early' }), laneId: 'l2', at: 0.2 },
    ])
    expect(built.map((f) => f.groupId)).toEqual(['early', 'late'])
  })
})

describe('collisions — the same-lane overlap LAW', () => {
  const lane = (items: Array<{ id: string; at: number; groupId?: string }>): ModelLane => ({
    id: 'main',
    label: 'Main',
    items: items.map((i) => ({
      item: at(i.id, 'main', i.at, i.groupId ? { groupId: i.groupId } : {}),
      laneId: 'main',
      at: i.at,
    })),
  })

  it('flags two same-lane items within epsilon that do not share a group', () => {
    expect(collisions(lane([{ id: 'a', at: 0.5 }, { id: 'b', at: 0.505 }]))).toEqual([['a', 'b']])
  })

  it('does NOT flag same-lane items that share a group (intentional pairing)', () => {
    expect(collisions(lane([{ id: 'a', at: 0.5, groupId: 'g' }, { id: 'b', at: 0.5, groupId: 'g' }]))).toEqual([])
  })

  it('does NOT flag well-separated items', () => {
    expect(collisions(lane([{ id: 'a', at: 0.1 }, { id: 'b', at: 0.9 }]))).toEqual([])
  })

  it('a COLLISION never becomes a frame, and a FRAME never becomes a collision', () => {
    // the same two titles, once piled in one lane and once shared across two
    const piled = buildModel(
      data(CONTINUOUS, ['main'], [at('a', 'main', 0.5), at('b', 'main', 0.5)]),
    )
    expect(piled.frames).toEqual([])
    expect(collisions(piled.lanes[0]!)).toEqual([['a', 'b']])

    const shared = buildModel(
      data(CONTINUOUS, ['main', 'arc'], [
        at('a', 'main', 0.5, { groupId: 'g' }),
        at('b', 'arc', 0.5, { groupId: 'g' }),
      ]),
    )
    expect(shared.frames).toHaveLength(1)
    expect(shared.lanes.flatMap((l) => collisions(l))).toEqual([])
  })

  it('respects a wider epsilon', () => {
    expect(collisions(lane([{ id: 'a', at: 0.4 }, { id: 'b', at: 0.5 }]), 0.2)).toEqual([['a', 'b']])
  })
})

describe('tensionCurve', () => {
  it('uses the author-set tension when there is one', () => {
    const model = buildModel(data(CONTINUOUS, ['main'], [at('a', 'main', 0.5, { tension: 0.77 })]))
    expect(tensionCurve(model.items)[0]!.y).toBeCloseTo(0.77, 5)
  })

  it('derives a rising-then-releasing curve when nobody set one, so it is never flat', () => {
    const model = buildModel(
      data(CONTINUOUS, ['main'], [at('d', 'main', 1), at('a', 'main', 0.05), at('c', 'main', 0.85), at('b', 'main', 0.5)]),
    )
    const points = tensionCurve(model.items)
    expect(points.map((p) => p.x)).toEqual([0.05, 0.5, 0.85, 1])
    expect(points[2]!.y).toBeGreaterThan(points[1]!.y) // rises to the climax
    expect(points[3]!.y).toBeLessThan(points[2]!.y) // then releases
    points.forEach((p) => {
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(1)
    })
  })

  it('clamps a nonsense tension into [0,1] and carries the item id', () => {
    const model = buildModel(data(CONTINUOUS, ['main'], [at('a', 'main', 0.5, { tension: 9 })]))
    expect(tensionCurve(model.items)[0]).toEqual({ x: 0.5, y: 1, itemId: 'a' })
  })
})
