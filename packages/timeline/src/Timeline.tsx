/* ============================================================================
 * Timeline.tsx — the component. All the arithmetic lives in model.ts; this file
 * is DOM, pointers and keys.
 *
 * Interaction is the drafting app's StoryTimelineBoard, reduced to the parts that are
 * not about beats:
 *   • DRAG is raw pointer events — pointerdown on a card, `pointermove` /
 *     `pointerup` on `window`, a 4px threshold before anything moves, and one
 *     inline `transform` on the dragged card cleared on drop or cancel. No DnD
 *     library: the board needs the pointer's x as a FRACTION of the bed and the
 *     lane under its y, which is two getBoundingClientRect calls, and a library
 *     would only hide them.
 *   • The drop resolves through the model: `dropPosition` → `insertionPosition`
 *     (continuous: land between the new neighbours, the rest slides forward) or
 *     `bucketAt` (buckets: whichever band the pointer is over).
 *   • KEYBOARD does the same moves without a pointer: arrows move the SELECTION,
 *     alt+arrows move the ITEM. Left/right re-time (or step a bucket), up/down
 *     change lane. Everything reachable by drag is reachable by key.
 *
 * The host owns the data: every gesture calls `onMove` and nothing else. This
 * component keeps no copy of the items, so a host that rejects a move simply
 * does not re-render one.
 * ========================================================================== */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  buildModel,
  collisions,
  computeLayout,
  dropPosition,
  insertionPosition,
  tensionCurve,
  type LayoutOptions,
  type Lane,
  type PositionedItem,
  type Position,
  type TimelineData,
  type TimelineLayout,
  type TimelineModel,
} from './model.js'

export interface TimelineMove {
  laneId: string
  position: Position
}

export interface RenderItemArgs {
  item: PositionedItem
  selected: boolean
  /** This item piles on another in its own lane — the overlap-LAW defect. */
  collides: boolean
}

export interface RenderLaneHeaderArgs {
  lane: Lane
  itemCount: number
  collisionCount: number
}

export interface TimelineProps {
  data: TimelineData
  /** A drag or an alt+arrow landed the item somewhere new. The host writes it and re-renders. */
  onMove?: (itemId: string, move: TimelineMove) => void
  onSelect?: (itemId: string | null) => void
  /** Given ⇒ the bar offers "Add a lane". */
  onLaneAdd?: () => void
  /** Given ⇒ a lane header's label is editable in place. */
  onLaneRename?: (laneId: string, label: string) => void
  renderItem?: (args: RenderItemArgs) => ReactNode
  renderLaneHeader?: (args: RenderLaneHeaderArgs) => ReactNode
  /** Draw the tension polyline over the lane beds. */
  tensionOverlay?: boolean
  /** No drags, no keyboard moves, no rename. Selection still works. */
  readOnly?: boolean
  /** Override the packing geometry (gap, gutter, laneHeight, …). */
  layout?: LayoutOptions
  /** Controlled selection. Omit to let the component hold it. */
  selectedId?: string | null
  title?: string
  /** Shown when there is nothing to lay out. */
  emptyTitle?: string
  emptyHint?: string
  className?: string
}

const DRAG_THRESHOLD = 4

export function Timeline({
  data,
  onMove,
  onSelect,
  onLaneAdd,
  onLaneRename,
  renderItem,
  renderLaneHeader,
  tensionOverlay = false,
  readOnly = false,
  layout: layoutOptions,
  selectedId: controlledSelection,
  title,
  emptyTitle = 'Nothing on the timeline yet',
  emptyHint = 'Add an item, or a lane to put one in — everything here is positioned along the axis, so an item needs both.',
  className,
}: TimelineProps): ReactElement {
  const model: TimelineModel = useMemo(() => buildModel(data), [data])
  const layout: TimelineLayout = useMemo(() => computeLayout(model, layoutOptions), [model, layoutOptions])

  const [ownSelection, setOwnSelection] = useState<string | null>(null)
  const selectedId = controlledSelection !== undefined ? controlledSelection : ownSelection
  const select = useCallback(
    (id: string | null) => {
      if (controlledSelection === undefined) setOwnSelection(id)
      onSelect?.(id)
    },
    [controlledSelection, onSelect],
  )

  const [dragId, setDragId] = useState<string | null>(null)
  const [dropLaneId, setDropLaneId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  /** Every item, by id — the drag and the keyboard both need the positioned form. */
  const byId = useMemo(() => new Map(model.items.map((p) => [p.item.id, p])), [model])

  /** Collision members, per lane, so a card can say it is piled on another. */
  const collided = useMemo(() => {
    const out = new Map<string, number>()
    for (const lane of model.lanes) {
      for (const [a, b] of collisions(lane)) {
        out.set(a, (out.get(a) ?? 0) + 1)
        out.set(b, (out.get(b) ?? 0) + 1)
      }
    }
    return out
  }, [model])

  /** The curve, already in BED coordinates: each point sits at its item's column, not at its
   *  raw axis fraction, so the line passes through the cards it describes. */
  const curve = useMemo(() => {
    if (!tensionOverlay) return []
    return tensionCurve(model.items)
      .map((point) => ({ x: layout.xOf(point.itemId), y: point.y }))
      .filter((point): point is { x: number; y: number } => point.x !== undefined)
  }, [tensionOverlay, model, layout])
  const peak = curve.reduce<{ x: number; y: number } | null>((best, p) => (!best || p.y > best.y ? p : best), null)

  // -- geometry from the DOM, the two measurements a drag needs --------------
  const bedFraction = useCallback((clientX: number): number => {
    const bed = scrollRef.current?.querySelector<HTMLElement>('[data-bed]')
    if (!bed) return 0
    const rect = bed.getBoundingClientRect()
    if (rect.width === 0) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  const laneUnder = useCallback((clientY: number): string | undefined => {
    for (const row of scrollRef.current?.querySelectorAll<HTMLElement>('[data-lane]') ?? []) {
      const rect = row.getBoundingClientRect()
      if (clientY >= rect.top && clientY <= rect.bottom) return row.dataset.lane
    }
    return undefined
  }, [])

  // -- drag ------------------------------------------------------------------
  const startDrag = useCallback(
    (positioned: PositionedItem) => (event: React.PointerEvent) => {
      if (readOnly || !onMove || event.button !== 0) return
      event.preventDefault()
      const card = event.currentTarget as HTMLElement
      const startX = event.clientX
      const startY = event.clientY
      const rect = card.getBoundingClientRect()
      // The card's CENTRE, not the grab point: the drop should land where the card looks.
      const grabDx = rect.left + rect.width / 2 - startX
      const itemId = positioned.item.id
      let active = false

      const resolve = (ev: PointerEvent): TimelineMove => ({
        laneId: laneUnder(ev.clientY) ?? positioned.laneId,
        position: dropPosition(model, layout, bedFraction(ev.clientX + grabDx), [itemId]),
      })

      const move = (ev: PointerEvent): void => {
        if (!active) {
          if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return
          active = true
          setDragId(itemId)
          select(itemId)
        }
        card.style.transform = `translate(calc(-50% + ${ev.clientX - startX}px), calc(-50% + ${ev.clientY - startY}px))`
        setDropLaneId(laneUnder(ev.clientY) ?? null)
      }

      const teardown = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        card.style.transform = ''
        setDragId(null)
        setDropLaneId(null)
      }

      const up = (ev: PointerEvent): void => {
        const wasDrag = active
        teardown()
        if (!wasDrag) {
          select(itemId)
          return
        }
        onMove(itemId, resolve(ev))
      }

      const cancel = (): void => teardown()

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
    },
    [readOnly, onMove, model, layout, laneUnder, bedFraction, select],
  )

  // -- keyboard --------------------------------------------------------------
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const key = event.key
      if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return
      const current = selectedId ? byId.get(selectedId) : undefined
      if (!current) return

      const moving = event.altKey
      if (moving && (readOnly || !onMove)) return
      event.preventDefault()

      const lanes = model.lanes
      const laneIndex = lanes.findIndex((l) => l.id === current.laneId)

      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const next = lanes[laneIndex + (key === 'ArrowDown' ? 1 : -1)]
        if (!next) return
        if (moving) {
          onMove?.(current.item.id, { laneId: next.id, position: current.item.position })
          return
        }
        // Selection follows to the nearest item on that lane.
        const nearest = next.items.reduce<PositionedItem | null>(
          (best, p) => (!best || Math.abs(p.at - current.at) < Math.abs(best.at - current.at) ? p : best),
          null,
        )
        if (nearest) select(nearest.item.id)
        return
      }

      const forward = key === 'ArrowRight'
      if (!moving) {
        // Selection steps along this lane in position order.
        const laneItems = lanes[laneIndex]?.items ?? []
        const index = laneItems.findIndex((p) => p.item.id === current.item.id)
        const next = laneItems[index + (forward ? 1 : -1)]
        if (next) select(next.item.id)
        return
      }

      if (model.axis.kind === 'buckets') {
        const buckets = model.axis.buckets
        const at = (current.bucket ?? 0) + (forward ? 1 : -1)
        const bucket = buckets[at]
        if (!bucket) return
        onMove?.(current.item.id, { laneId: current.laneId, position: { kind: 'bucket', key: bucket.key } })
        return
      }

      // Continuous: hop over the neighbouring column, then take the slot there.
      const others = layout.order.filter((c) => !c.itemIds.includes(current.item.id))
      const index = others.filter((c) => c.at < current.at).length
      const neighbour = forward ? others[index] : others[index - 1]
      if (!neighbour) return
      const beyond = forward ? others[index + 1] : others[index - 2]
      const frac = beyond ? (neighbour.x + beyond.x) / 2 : forward ? 1 : 0
      onMove?.(current.item.id, {
        laneId: current.laneId,
        position: insertionPosition(layout.order, frac, [current.item.id]),
      })
    },
    [selectedId, byId, model, layout, readOnly, onMove, select],
  )

  // A selected item that disappeared (the host deleted it) must not stay selected.
  useEffect(() => {
    if (selectedId && !byId.has(selectedId) && controlledSelection === undefined) setOwnSelection(null)
  }, [selectedId, byId, controlledSelection])

  const empty = model.items.length === 0 || model.lanes.length === 0
  const bandRows = [...layout.groupSpans].map(([id, span]) => ({
    span,
    label: model.groups.find((g) => g.id === id)?.label ?? id,
    id,
  }))

  return (
    <div className={className ? `tl-root ${className}` : 'tl-root'} onKeyDown={onKeyDown}>
      {(title || onLaneAdd) && (
        <div className="tl-bar">
          <h2 className="tl-bar-title">
            {title ?? 'Timeline'}{' '}
            <span className="tl-bar-sub">
              {model.axis.kind === 'buckets' ? `${model.axis.buckets.length} buckets` : 'beginning → end'}
            </span>
          </h2>
          {onLaneAdd && (
            <button type="button" className="tl-btn" onClick={onLaneAdd} disabled={readOnly}>
              Add a lane
            </button>
          )}
        </div>
      )}

      {empty ? (
        <div className="tl-empty">
          <div className="tl-empty-title">{emptyTitle}</div>
          <div>{emptyHint}</div>
        </div>
      ) : (
        <div className="tl-scroll" ref={scrollRef}>
          <div className="tl-inner" style={{ width: layout.innerWidth }}>
            {bandRows.length > 0 && (
              <div className="tl-bands">
                {bandRows.map((band) => (
                  <div
                    key={band.id}
                    className="tl-band"
                    style={{ left: `${band.span[0] * 100}%`, width: `${(band.span[1] - band.span[0]) * 100}%` }}
                    title={band.label}
                  >
                    {band.label}
                  </div>
                ))}
              </div>
            )}

            {model.axis.kind === 'buckets' && (
              <div className="tl-axis">
                {model.axis.buckets.map((bucket) => {
                  const span = layout.bucketSpans.get(bucket.key)
                  if (!span) return null
                  return (
                    <div
                      key={bucket.key}
                      className="tl-axis-cell"
                      style={{ left: `${span[0] * 100}%`, width: `${(span[1] - span[0]) * 100}%` }}
                    >
                      {bucket.label}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="tl-lanes">
              {model.lanes.map((lane) => {
                const laneCollisions = lane.items.filter((p) => collided.has(p.item.id)).length
                return (
                  <div
                    key={lane.id}
                    className="tl-lane"
                    data-lane={lane.id}
                    data-kind={lane.kind}
                    data-collapsed={lane.collapsed ? 'true' : 'false'}
                  >
                    <div className="tl-head">
                      {renderLaneHeader ? (
                        renderLaneHeader({ lane, itemCount: lane.items.length, collisionCount: laneCollisions })
                      ) : (
                        <>
                          <div className="tl-head-label">
                            <span className="tl-head-rail" style={lane.color ? { background: lane.color } : undefined} />
                            {onLaneRename && !readOnly ? (
                              <input
                                className="tl-head-name"
                                defaultValue={lane.label}
                                aria-label={`Rename ${lane.label}`}
                                onBlur={(e) => {
                                  const next = e.currentTarget.value.trim()
                                  if (next && next !== lane.label) onLaneRename(lane.id, next)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    e.currentTarget.blur()
                                  }
                                  e.stopPropagation()
                                }}
                              />
                            ) : (
                              <span className="tl-head-name">{lane.label}</span>
                            )}
                          </div>
                          <div className="tl-head-meta">
                            {lane.items.length} item{lane.items.length === 1 ? '' : 's'}
                            {laneCollisions > 0 && <span className="tl-head-warn"> · {laneCollisions} piled</span>}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="tl-bed" data-bed="" data-drop={dropLaneId === lane.id ? 'true' : 'false'}>
                      <div className="tl-bed-line" />
                      {!lane.collapsed &&
                        lane.items.map((positioned) => {
                          const x = layout.xOf(positioned.item.id)
                          if (x === undefined) return null
                          const isSelected = selectedId === positioned.item.id
                          const collides = collided.has(positioned.item.id)
                          return (
                            <div
                              key={positioned.item.id}
                              className="tl-card"
                              role="button"
                              tabIndex={0}
                              data-item={positioned.item.id}
                              data-selected={isSelected ? 'true' : 'false'}
                              data-frame={positioned.frameId ? 'true' : 'false'}
                              data-collision={collides ? 'true' : 'false'}
                              data-dragging={dragId === positioned.item.id ? 'true' : 'false'}
                              data-readonly={readOnly ? 'true' : 'false'}
                              style={{ left: `${x * 100}%` }}
                              onPointerDown={startDrag(positioned)}
                              onClick={() => select(positioned.item.id)}
                              onFocus={() => select(positioned.item.id)}
                            >
                              {renderItem ? (
                                renderItem({ item: positioned, selected: isSelected, collides })
                              ) : (
                                <>
                                  <div className="tl-card-title">{positioned.item.title}</div>
                                  {positioned.item.subtitle && (
                                    <div className="tl-card-sub">{positioned.item.subtitle}</div>
                                  )}
                                </>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )
              })}

              {tensionOverlay && curve.length > 1 && (
                <svg className="tl-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                  <polyline className="tl-curve-base" points="0,0.5 1,0.5" />
                  <polyline className="tl-curve" points={curve.map((p) => `${p.x},${1 - p.y}`).join(' ')} />
                  {peak && <rect className="tl-curve-peak" x={peak.x - 0.001} y={0} width={0.002} height={1} />}
                </svg>
              )}
            </div>
          </div>
        </div>
      )}

      {!readOnly && !empty && (
        <p className="tl-hint">
          Drag a card to re-time it, or into another lane. With one selected: arrows move the selection, alt+arrows
          move the card.
        </p>
      )}
    </div>
  )
}

export default Timeline
