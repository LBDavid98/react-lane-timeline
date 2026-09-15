/* ============================================================================
 * render.test.tsx — the smoke test: the component renders the model, and a
 * simulated DROP calls onMove with the position the pure model would compute.
 *
 * jsdom does no layout, so every rect the drag reads is stubbed here to a board
 * with a 200px gutter and a 1000px bed. That stub is the whole reason this test
 * can exist: the drag's only inputs are the bed's rect, the lane rows' rects and
 * the dragged card's centre — three getBoundingClientRect calls, which is why
 * there is no DnD library to mock.
 * ========================================================================== */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Timeline } from '../src/Timeline.js'
import { buildModel, computeLayout, insertionPosition, type TimelineData } from '../src/model.js'

const LANE_H = 100
const BED_LEFT = 200
const BED_W = 1000
const CARD_W = 138

let restore: (() => void) | null = null

/** A board with a 200px gutter and a 1000px bed, four lanes tall. */
function stubRects(): void {
  const original = HTMLElement.prototype.getBoundingClientRect
  restore = () => {
    HTMLElement.prototype.getBoundingClientRect = original
  }
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const laneEl = this.hasAttribute('data-lane') ? this : this.closest('[data-lane]')
    const index = laneEl ? [...document.querySelectorAll('[data-lane]')].indexOf(laneEl) : 0
    const top = index * LANE_H
    const box = (left: number, width: number): DOMRect =>
      ({
        x: left,
        y: top,
        left,
        top,
        right: left + width,
        bottom: top + LANE_H,
        width,
        height: LANE_H,
        toJSON: () => ({}),
      }) as DOMRect
    if (this.hasAttribute('data-lane')) return box(0, BED_LEFT + BED_W)
    if (this.hasAttribute('data-bed')) return box(BED_LEFT, BED_W)
    if (this.hasAttribute('data-item')) {
      const percent = Number.parseFloat(this.style.left) || 0
      const centre = BED_LEFT + (percent / 100) * BED_W
      return box(centre - CARD_W / 2, CARD_W)
    }
    return box(0, 0)
  }
}

afterEach(() => {
  restore?.()
  restore = null
})

const DATA: TimelineData = {
  axis: { kind: 'continuous' },
  lanes: [
    { id: 'main', label: 'Main spine' },
    { id: 'sub', label: 'The drowned bell' },
  ],
  items: [
    { id: 'a', laneId: 'main', title: 'Opening image', position: { kind: 'continuous', at: 0.1 } },
    { id: 'b', laneId: 'main', title: 'Midpoint', subtitle: 'the turn', position: { kind: 'continuous', at: 0.5 } },
    { id: 'c', laneId: 'main', title: 'Climax', position: { kind: 'continuous', at: 0.9 } },
  ],
}

const BUCKET_DATA: TimelineData = {
  axis: {
    kind: 'buckets',
    buckets: [
      { key: 'now', label: 'Now' },
      { key: 'next', label: 'Next' },
      { key: 'later', label: 'Later' },
    ],
  },
  lanes: [{ id: 'platform', label: 'Platform' }],
  items: [
    { id: 'r1', laneId: 'platform', title: 'Ship the gateway', position: { kind: 'bucket', key: 'now' } },
    { id: 'r2', laneId: 'platform', title: 'Rotate the keys', position: { kind: 'bucket', key: 'later' } },
  ],
}

const card = (id: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-item="${id}"]`)
  if (!element) throw new Error(`no card for ${id}`)
  return element
}

describe('Timeline renders the model', () => {
  it('draws every lane header and every item', () => {
    render(<Timeline data={DATA} />)
    expect(screen.getByText('Main spine')).toBeTruthy()
    expect(screen.getByText('The drowned bell')).toBeTruthy()
    expect(screen.getByText('Opening image')).toBeTruthy()
    expect(screen.getByText('the turn')).toBeTruthy()
    expect(document.querySelectorAll('[data-item]')).toHaveLength(3)
  })

  it('lays each card at its layout column, left-packed rather than distance-scaled', () => {
    render(<Timeline data={DATA} />)
    const layout = computeLayout(buildModel(DATA))
    for (const id of ['a', 'b', 'c']) {
      expect(card(id).style.left).toBe(`${layout.xOf(id)! * 100}%`)
    }
    // 0.9 of the way along the axis is nowhere near 90% of the bed: the columns are packed.
    expect(Number.parseFloat(card('c').style.left)).toBeLessThan(60)
  })

  it('shows the empty state, not an empty board, when there is nothing to lay out', () => {
    render(<Timeline data={{ axis: { kind: 'continuous' }, lanes: [], items: [] }} />)
    expect(screen.getByText('Nothing on the timeline yet')).toBeTruthy()
    expect(document.querySelector('[data-item]')).toBeNull()
  })

  it('draws a bucket axis with its bucket labels', () => {
    render(<Timeline data={BUCKET_DATA} />)
    for (const label of ['Now', 'Next', 'Later']) expect(screen.getByText(label)).toBeTruthy()
    expect(document.querySelectorAll('[data-item]')).toHaveLength(2)
  })

  it('marks frame members and collision members, so the overlap LAW is visible', () => {
    render(
      <Timeline
        data={{
          axis: { kind: 'continuous' },
          lanes: [
            { id: 'main', label: 'Main' },
            { id: 'arc', label: 'Arc' },
          ],
          items: [
            { id: 'f1', laneId: 'main', title: 'Shared', position: { kind: 'continuous', at: 0.5 }, groupId: 'g' },
            { id: 'f2', laneId: 'arc', title: 'Shared too', position: { kind: 'continuous', at: 0.5 }, groupId: 'g' },
            { id: 'p1', laneId: 'main', title: 'Piled', position: { kind: 'continuous', at: 0.9 } },
            { id: 'p2', laneId: 'main', title: 'Piled too', position: { kind: 'continuous', at: 0.905 } },
          ],
        }}
      />,
    )
    expect(card('f1').dataset.frame).toBe('true')
    expect(card('p1').dataset.collision).toBe('true')
    expect(card('p1').dataset.frame).toBe('false')
    expect(card('f1').dataset.collision).toBe('false')
  })

  it('draws the tension polyline only when asked', () => {
    const { unmount } = render(<Timeline data={DATA} />)
    expect(document.querySelector('.tl-curve')).toBeNull()
    unmount()
    render(<Timeline data={DATA} tensionOverlay />)
    expect(document.querySelector('.tl-curve')).toBeTruthy()
  })

  it('offers Add a lane only when the host handles it', () => {
    const onLaneAdd = vi.fn()
    const { unmount } = render(<Timeline data={DATA} />)
    expect(screen.queryByText('Add a lane')).toBeNull()
    unmount()
    render(<Timeline data={DATA} onLaneAdd={onLaneAdd} />)
    fireEvent.click(screen.getByText('Add a lane'))
    expect(onLaneAdd).toHaveBeenCalledOnce()
  })

  it('renames a lane through the host, on blur', () => {
    const onLaneRename = vi.fn()
    render(<Timeline data={DATA} onLaneRename={onLaneRename} />)
    const input = screen.getByLabelText('Rename Main spine') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'The Ashfall spine' } })
    fireEvent.blur(input)
    expect(onLaneRename).toHaveBeenCalledWith('main', 'The Ashfall spine')
  })

  it('honours a custom item renderer', () => {
    render(<Timeline data={DATA} renderItem={({ item }) => <b>{item.item.id.toUpperCase()}</b>} />)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.queryByText('Opening image')).toBeNull()
  })
})

describe('selection', () => {
  it('reports a click, and marks the card selected', () => {
    const onSelect = vi.fn()
    render(<Timeline data={DATA} onSelect={onSelect} />)
    fireEvent.click(card('b'))
    expect(onSelect).toHaveBeenCalledWith('b')
    expect(card('b').dataset.selected).toBe('true')
  })

  it('steps the selection along a lane with the arrow keys', () => {
    const onSelect = vi.fn()
    render(<Timeline data={DATA} onSelect={onSelect} />)
    fireEvent.click(card('a'))
    fireEvent.keyDown(card('a'), { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('b')
  })
})

describe('a drop calls onMove with the position the model computes', () => {
  it('re-times within a lane', () => {
    stubRects()
    const onMove = vi.fn()
    render(<Timeline data={DATA} onMove={onMove} />)
    const layout = computeLayout(buildModel(DATA))
    const centre = BED_LEFT + layout.xOf('a')! * BED_W

    fireEvent.pointerDown(card('a'), { button: 0, clientX: centre, clientY: 50 })
    fireEvent.pointerMove(window, { clientX: 900, clientY: 50 })
    fireEvent.pointerUp(window, { clientX: 900, clientY: 50 })

    const expected = insertionPosition(layout.order, (900 - BED_LEFT) / BED_W, ['a'])
    expect(onMove).toHaveBeenCalledWith('a', { laneId: 'main', position: expected })
    expect(expected).toEqual({ kind: 'continuous', at: 0.95 }) // past the last column: midpoint against 1
  })

  it('moves across lanes, taking the lane under the pointer', () => {
    stubRects()
    const onMove = vi.fn()
    render(<Timeline data={DATA} onMove={onMove} />)
    const layout = computeLayout(buildModel(DATA))
    const centre = BED_LEFT + layout.xOf('b')! * BED_W

    fireEvent.pointerDown(card('b'), { button: 0, clientX: centre, clientY: 50 })
    fireEvent.pointerMove(window, { clientX: 400, clientY: 150 }) // the second lane's row
    fireEvent.pointerUp(window, { clientX: 400, clientY: 150 })

    expect(onMove).toHaveBeenCalledWith('b', {
      laneId: 'sub',
      position: insertionPosition(layout.order, (400 - BED_LEFT) / BED_W, ['b']),
    })
  })

  it('writes a BUCKET position on a bucket axis', () => {
    stubRects()
    const onMove = vi.fn()
    render(<Timeline data={BUCKET_DATA} onMove={onMove} />)
    const layout = computeLayout(buildModel(BUCKET_DATA))
    const centre = BED_LEFT + layout.xOf('r1')! * BED_W
    const [start, end] = layout.bucketSpans.get('later')!
    const target = BED_LEFT + ((start + end) / 2) * BED_W

    fireEvent.pointerDown(card('r1'), { button: 0, clientX: centre, clientY: 50 })
    fireEvent.pointerMove(window, { clientX: target, clientY: 50 })
    fireEvent.pointerUp(window, { clientX: target, clientY: 50 })

    expect(onMove).toHaveBeenCalledWith('r1', { laneId: 'platform', position: { kind: 'bucket', key: 'later' } })
  })

  it('a click that never passed the drag threshold selects instead of moving', () => {
    stubRects()
    const onMove = vi.fn()
    const onSelect = vi.fn()
    render(<Timeline data={DATA} onMove={onMove} onSelect={onSelect} />)
    const centre = BED_LEFT + computeLayout(buildModel(DATA)).xOf('a')! * BED_W

    fireEvent.pointerDown(card('a'), { button: 0, clientX: centre, clientY: 50 })
    fireEvent.pointerMove(window, { clientX: centre + 2, clientY: 51 })
    fireEvent.pointerUp(window, { clientX: centre + 2, clientY: 51 })

    expect(onMove).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('readOnly drags nothing', () => {
    stubRects()
    const onMove = vi.fn()
    render(<Timeline data={DATA} onMove={onMove} readOnly />)
    fireEvent.pointerDown(card('a'), { button: 0, clientX: 300, clientY: 50 })
    fireEvent.pointerMove(window, { clientX: 900, clientY: 150 })
    fireEvent.pointerUp(window, { clientX: 900, clientY: 150 })
    expect(onMove).not.toHaveBeenCalled()
  })
})

describe('alt+arrows move the item, so everything a drag can do a key can do', () => {
  it('alt+ArrowDown moves the item to the next lane, keeping its position', () => {
    const onMove = vi.fn()
    render(<Timeline data={DATA} onMove={onMove} />)
    fireEvent.click(card('b'))
    fireEvent.keyDown(card('b'), { key: 'ArrowDown', altKey: true })
    expect(onMove).toHaveBeenCalledWith('b', { laneId: 'sub', position: { kind: 'continuous', at: 0.5 } })
  })

  it('alt+ArrowRight re-times the item past its neighbour', () => {
    const onMove = vi.fn()
    render(<Timeline data={DATA} onMove={onMove} />)
    fireEvent.click(card('a'))
    fireEvent.keyDown(card('a'), { key: 'ArrowRight', altKey: true })
    const [, move] = onMove.mock.calls[0] as [string, { position: { at: number } }]
    expect(move.position.at).toBeGreaterThan(0.5) // now between b and c
    expect(move.position.at).toBeLessThan(0.9)
  })

  it('alt+ArrowRight steps a bucket on a bucket axis', () => {
    const onMove = vi.fn()
    render(<Timeline data={BUCKET_DATA} onMove={onMove} />)
    fireEvent.click(card('r1'))
    fireEvent.keyDown(card('r1'), { key: 'ArrowRight', altKey: true })
    expect(onMove).toHaveBeenCalledWith('r1', { laneId: 'platform', position: { kind: 'bucket', key: 'next' } })
  })

  it('an alt+arrow off the end of the board does nothing', () => {
    const onMove = vi.fn()
    render(<Timeline data={DATA} onMove={onMove} />)
    fireEvent.click(card('a'))
    fireEvent.keyDown(card('a'), { key: 'ArrowUp', altKey: true })
    expect(onMove).not.toHaveBeenCalled()
  })

  it('readOnly moves nothing by keyboard either', () => {
    const onMove = vi.fn()
    render(<Timeline data={DATA} onMove={onMove} readOnly />)
    fireEvent.click(card('b'))
    fireEvent.keyDown(card('b'), { key: 'ArrowDown', altKey: true })
    expect(onMove).not.toHaveBeenCalled()
  })
})
