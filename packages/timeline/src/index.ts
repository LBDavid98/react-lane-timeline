/**
 * `react-lane-timeline` — a lanes + sequence frame.
 *
 * The component and the model, in one entry. Import the stylesheet yourself
 * (`react-lane-timeline/timeline.css`) plus an adapter for your host's palette
 * (`react-lane-timeline/adapters/default.css`), so a host can restyle without
 * touching the package.
 *
 * The pure model is also its own entry — `react-lane-timeline/model` pulls in no
 * React, so a server route can compute a layout.
 */
export { Timeline, default } from './Timeline.js'
export type {
  RenderItemArgs,
  RenderLaneHeaderArgs,
  TimelineMove,
  TimelineProps,
} from './Timeline.js'

export {
  bucketAt,
  buildModel,
  collisions,
  computeLayout,
  dropPosition,
  EPSILON,
  FOLLOWER,
  frames,
  GAP,
  GUTTER,
  insertionPosition,
  LANE_HEIGHT,
  LANE_HEIGHT_COLLAPSED,
  MIN_BUCKET,
  MIN_CONTENT,
  resolveAt,
  tensionCurve,
} from './model.js'
export type {
  Axis,
  BucketPosition,
  ContinuousPosition,
  Frame,
  Group,
  Item,
  Lane,
  LaneRow,
  LayoutColumn,
  LayoutOptions,
  ModelLane,
  Position,
  PositionedItem,
  TensionPoint,
  TimelineData,
  TimelineLayout,
  TimelineModel,
} from './model.js'

export { SURFACES, SURFACE_SUBPATH } from './registry.js'
export type { Surface } from './registry.js'

export { TOKENS, tokenProperty } from './theme/tokens.js'
export type { Token, TokenProperty } from './theme/tokens.js'
