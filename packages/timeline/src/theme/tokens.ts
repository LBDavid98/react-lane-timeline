/**
 * The public theme hooks. A host (or an adapter file, `adapters/<host>.css`) sets
 * `--tl-<name>`; `timeline.css` resolves each ONCE into a private `--_tl-<name>`
 * role and paints only from those. `contract.test.ts` holds this list and the
 * stylesheet to each other in both directions, so neither can drift.
 *
 * The discipline is a sibling package's (`packages/studio/src/theme/tokens.ts`),
 * for the same reason: a host token name in a fallback chain resolves in one app and
 * silently falls through in the next.
 */
export const TOKENS = [
  // surfaces & ink
  'bg',
  /** The lane bed — the strip an item sits on. */
  'bg-lane',
  'bg-raised',
  'text',
  'text-muted',
  'line',
  // accent & status
  'accent',
  'accent-soft',
  'good',
  'warn',
  'danger',
  // shape, space, type
  'radius',
  'gap',
  'font-ui',
  'font-mono',
  'text-size',
  // geometry a host may want a say in
  /** Lane row height. Pass the same value as `computeLayout`'s `laneHeight` if you read `laneRows`. */
  'lane-height',
  /** Lane-header gutter width. Pass the same value as `computeLayout`'s `gutter`. */
  'gutter',
] as const

export type Token = (typeof TOKENS)[number]

/** `--tl-bg`, … — the property name a host sets. */
export type TokenProperty = `--tl-${Token}`

export const tokenProperty = (token: Token): TokenProperty => `--tl-${token}`
