/**
 * Both axis kinds, side by side, over in-memory data — so a drag is verifiable
 * without a backend. The state lives here, exactly as a host's would: the
 * component reports a move and this page writes it.
 */
import { useState, type ReactElement } from 'react'
import { Timeline, type Item, type TimelineData, type TimelineMove } from 'react-lane-timeline'

const PLOT: TimelineData = {
  axis: { kind: 'continuous' },
  lanes: [
    { id: 'main', label: 'Main spine', kind: 'main' },
    { id: 'kara', label: "Kara's arc", kind: 'character-arc', color: '#7fb3d5' },
    { id: 'bell', label: 'The drowned bell', kind: 'subplot', color: '#c9a227' },
  ],
  groups: [
    { id: 'act1', label: 'Act I', span: [0, 0.3] },
    { id: 'act2', label: 'Act II', span: [0.3, 0.75] },
    { id: 'act3', label: 'Act III', span: [0.75, 1] },
  ],
  items: [
    { id: 'p1', laneId: 'main', title: 'Opening image', position: { kind: 'continuous', at: 0.04 }, tension: 0.15 },
    { id: 'p2', laneId: 'main', title: 'The summons', subtitle: 'inciting', position: { kind: 'continuous', at: 0.18 }, tension: 0.3 },
    { id: 'p3', laneId: 'main', title: 'Into the flood', position: { kind: 'continuous', at: 0.34 }, groupId: 'flood', tension: 0.45 },
    { id: 'p4', laneId: 'main', title: 'Midpoint', subtitle: 'the turn', position: { kind: 'continuous', at: 0.52 }, tension: 0.55 },
    { id: 'p5', laneId: 'main', title: 'All is lost', position: { kind: 'continuous', at: 0.72 }, tension: 0.4 },
    { id: 'p6', laneId: 'main', title: 'Climax', position: { kind: 'continuous', at: 0.88 }, tension: 0.95 },
    { id: 'p7', laneId: 'main', title: 'Resolution', position: { kind: 'continuous', at: 0.98 }, tension: 0.2 },
    { id: 'k1', laneId: 'kara', title: 'Wants out', position: { kind: 'continuous', at: 0.12 }, tension: 0.2 },
    { id: 'k2', laneId: 'kara', title: 'Tested by water', position: { kind: 'continuous', at: 0.34 }, groupId: 'flood', tension: 0.5 },
    { id: 'k3', laneId: 'kara', title: 'Crisis of nerve', position: { kind: 'continuous', at: 0.78 }, tension: 0.72 },
    { id: 'b1', laneId: 'bell', title: 'The bell is found', position: { kind: 'continuous', at: 0.26 }, tension: 0.35 },
    { id: 'b2', laneId: 'bell', title: 'It rings alone', position: { kind: 'continuous', at: 0.66 }, tension: 0.6 },
  ],
}

const ROADMAP: TimelineData = {
  axis: {
    kind: 'buckets',
    buckets: [
      { key: 'now', label: 'Now' },
      { key: 'next', label: 'Next' },
      { key: 'later', label: 'Later' },
      { key: 'dated', label: 'Dated' },
    ],
  },
  lanes: [
    { id: 'platform', label: 'Platform' },
    { id: 'apps', label: 'Apps', color: '#7fb3d5' },
    { id: 'ops', label: 'Ops', color: '#c9a227' },
  ],
  items: [
    { id: 'r1', laneId: 'platform', title: 'Theme tokens', position: { kind: 'bucket', key: 'now' } },
    { id: 'r2', laneId: 'platform', title: 'Virtual lanes', position: { kind: 'bucket', key: 'later' } },
    { id: 'r3', laneId: 'apps', title: 'Outline editor', subtitle: 'P2', position: { kind: 'bucket', key: 'now' } },
    { id: 'r4', laneId: 'apps', title: 'Offline sync', position: { kind: 'bucket', key: 'next' } },
    { id: 'r5', laneId: 'ops', title: 'Test advisories', position: { kind: 'bucket', key: 'next' } },
    { id: 'r6', laneId: 'ops', title: 'Restore drill', position: { kind: 'bucket', key: 'dated' } },
  ],
}

/** Apply a move to a plain item list — the whole write path a host needs. */
const applyMove = (items: Item[], itemId: string, move: TimelineMove): Item[] =>
  items.map((item) => (item.id === itemId ? { ...item, laneId: move.laneId, position: move.position } : item))

export function DemoPage(): ReactElement {
  const [plot, setPlot] = useState(PLOT)
  const [roadmap, setRoadmap] = useState(ROADMAP)
  const [lastMove, setLastMove] = useState<string>('')

  const onMove = (
    set: typeof setPlot,
  ): ((itemId: string, move: TimelineMove) => void) => (itemId, move) => {
    set((data) => ({ ...data, items: applyMove(data.items, itemId, move) }))
    setLastMove(
      `${itemId} → ${move.laneId} · ${
        move.position.kind === 'bucket' ? move.position.key : move.position.at.toFixed(3)
      }`,
    )
  }

  return (
    <>
      <section className="sh-block">
        <h2 className="sh-h">Continuous axis — a story plot timeline</h2>
        <p className="sh-p">
          Lanes are plotlines; a position is a fraction of the whole story. Drag a card to re-time it or to move it
          to another lane; the cross-lane pair at "Into the flood" is a frame and shares one column.
        </p>
        <Timeline
          data={plot}
          onMove={onMove(setPlot)}
          onLaneAdd={() =>
            setPlot((data) => ({
              ...data,
              lanes: [...data.lanes, { id: `lane${data.lanes.length}`, label: `New lane ${data.lanes.length}` }],
            }))
          }
          onLaneRename={(laneId, label) =>
            setPlot((data) => ({
              ...data,
              lanes: data.lanes.map((lane) => (lane.id === laneId ? { ...lane, label } : lane)),
            }))
          }
          tensionOverlay
          title="Storyline"
        />
      </section>

      <section className="sh-block">
        <h2 className="sh-h">Bucket axis — a product roadmap</h2>
        <p className="sh-p">
          The same frame, bucketed: a position is a horizon, not a number. A drop writes the bucket it landed in, and
          an empty bucket keeps its band.
        </p>
        <Timeline data={roadmap} onMove={onMove(setRoadmap)} title="Roadmap" />
      </section>

      {lastMove && <p className="sh-note">last move · {lastMove}</p>}
    </>
  )
}
