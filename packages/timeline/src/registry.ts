/**
 * `react-lane-timeline/registry` — what this package ships. Pure data: no React,
 * no DOM, server-safe, so a host's conformance check can read it without loading
 * the component.
 *
 * One surface. A lanes + sequence frame is one idea, and the package stays one
 * idea wide — the axis kinds are `Axis`, not two surfaces.
 */
export const SURFACES = ['timeline'] as const

export type Surface = (typeof SURFACES)[number]

/** Package subpath each surface ships under. */
export const SURFACE_SUBPATH: Record<Surface, string> = { timeline: '.' }
