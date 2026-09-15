/* ============================================================================
 * contract.test.ts — the promises this package makes about its own CSS.
 * Mirrors a sibling package's contract test.
 *
 * These claims decide whether the timeline can be dropped into a host nobody
 * here has seen, and all of them rot SILENTLY: nothing throws when a stylesheet
 * reads a token that does not exist, when an adapter maps a name its host never
 * declares, or when a rule quietly grows a `position: fixed`. So they are
 * checked rather than documented.
 *
 * THE ONE DIFFERENCE FROM VS's VERSION, and why. VS forbids `position` outright,
 * because a gallery is flow content. A timeline is not: a card's whole job is to
 * sit at an x along a bed. So the rule here is SCOPING rather than abstinence —
 * every selector is a .tl-root internal, position is only relative/absolute/
 * sticky (never `fixed`), z-index stays single-digit and local, and there is no
 * viewport unit anywhere. Nothing can escape the box the host gave us.
 * ========================================================================== */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe as group, expect, it } from 'vitest'
import { TOKENS } from '../src/theme/tokens.js'

const here = join(process.cwd(), 'src')
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
const sheet = strip(readFileSync(join(here, 'timeline.css'), 'utf8'))

const ADAPTERS = readdirSync(join(here, 'adapters')).filter((f) => f.endsWith('.css'))

/** Every `--name:` declared anywhere in the text, in source order. */
const declared = (css: string): string[] =>
  [...css.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:/g)].map((m) => m[1] as string)

/** Every `var(--name` read anywhere in the text. */
const used = (css: string): Set<string> =>
  new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1] as string))

/** The one block that resolves the public hooks into private roles. */
const ROLE_BLOCK_START = sheet.indexOf(':where(.tl-root) {')
const ROLE_BLOCK = sheet.slice(ROLE_BLOCK_START, sheet.indexOf('}', ROLE_BLOCK_START) + 1)
const roles = declared(ROLE_BLOCK)
const REST = sheet.slice(0, ROLE_BLOCK_START) + sheet.slice(ROLE_BLOCK_START + ROLE_BLOCK.length)

/** The one private property that is not a role: the card width, read in two places. */
const PRIVATE_EXTRAS = ['--_tl-card-w']

group('the token vocabulary holds together', () => {
  it('TOKENS lists every hook once', () => {
    expect(new Set(TOKENS).size).toBe(TOKENS.length)
    expect(TOKENS).toHaveLength(18)
  })

  it('declares one role per token, each resolving its own --tl-* hook and a literal', () => {
    expect(roles).toEqual(TOKENS.map((t) => `--_tl-${t}`))
    for (const token of TOKENS) {
      const line = ROLE_BLOCK.match(new RegExp(`--_tl-${token}:([^;]+);`))?.[1] ?? ''
      // `var(--tl-x, <literal>)` — the hook first so a host can override it,
      // a literal second so a host that maps nothing still gets a timeline.
      expect(line, token).toMatch(new RegExp(`^\\s*var\\(\\s*--tl-${token}\\s*,\\s*[^\\s)]`))
      expect(line, `${token} fallback must be a literal, not another var()`).not.toMatch(/,\s*var\(/)
    }
  })

  it('declares each role exactly once in the whole file', () => {
    const everywhere = declared(sheet).filter((p) => p.startsWith('--_tl-'))
    for (const role of roles) expect(everywhere.filter((p) => p === role), role).toHaveLength(1)
  })

  it('the only other private properties are the documented extras', () => {
    expect([...new Set(declared(REST))]).toEqual(PRIVATE_EXTRAS)
  })

  it('paints only from roles it declares — no read of an undefined token', () => {
    for (const token of used(sheet)) {
      if (token.startsWith('--tl-')) continue
      expect([...roles, ...PRIVATE_EXTRAS], token).toContain(token)
    }
  })

  it('declares no role nothing paints with', () => {
    const reads = used(REST)
    for (const role of roles) expect(reads, role).toContain(role)
  })

  it('reads a --tl-* hook only where it resolves one into a role', () => {
    expect([...used(REST)].filter((t) => t.startsWith('--tl-'))).toEqual([])
  })

  it('never declares a public --tl-* hook itself', () => {
    expect(declared(sheet).filter((p) => p.startsWith('--tl-'))).toEqual([])
  })
})

group('nothing escapes the host’s box', () => {
  /** Every top-level selector in the file, split on commas. */
  const selectors = [...sheet.matchAll(/([^{}]+)\{/g)].flatMap((m) =>
    (m[1] as string).split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean),
  )

  it('scopes every selector to a .tl-* class, so no rule reaches the host’s page', () => {
    expect(selectors.length).toBeGreaterThan(20)
    for (const selector of selectors) expect(selector, selector).toMatch(/\.tl-/)
  })

  it('positions only relative, absolute or sticky — never fixed', () => {
    const values = [...sheet.matchAll(/(?:^|[;{])\s*position\s*:\s*([^;}]+)/g)].map((m) => (m[1] as string).trim())
    expect(values.length).toBeGreaterThan(0) // a timeline does position things — that is the point
    for (const value of values) expect(['relative', 'absolute', 'sticky'], value).toContain(value)
  })

  it('keeps z-index single-digit and local to the root’s own stacking context', () => {
    for (const m of sheet.matchAll(/(?:^|[;{])\s*z-index\s*:\s*([^;}]+)/g)) {
      const value = Number((m[1] as string).trim())
      expect(Number.isInteger(value) && value >= 0 && value < 10, m[1]).toBe(true)
    }
  })

  it('measures nothing in viewport units — the host owns the box’s size', () => {
    expect(sheet.match(/\b\d[\d.]*(?:vh|vw|vmin|vmax|dvh|svh|lvh|dvw|svw|lvw)\b/g)).toBeNull()
  })

  it('offsets (top/right/bottom/left/inset) only inside a positioned .tl-* internal', () => {
    // Every rule that offsets must also be scoped — the selector check above already
    // guarantees .tl-*, so this only has to prove no offset sits in the role block,
    // where it would apply to the root itself.
    expect(ROLE_BLOCK).not.toMatch(/(?:^|[;{])\s*(?:position|z-index|inset|top|right|bottom|left)\s*:/)
  })
})

group('an adapter maps tokens and paints nothing', () => {
  /** The --tl-* hooks timeline.css actually resolves. */
  const hooks = new Set([...sheet.matchAll(/--_tl-[\w-]+:\s*var\(\s*(--tl-[\w-]+)/g)].map((m) => m[1] as string))

  it('ships exactly one adapter — its own default palette', () => {
    expect([...ADAPTERS].sort()).toEqual(['default.css'])
  })

  for (const file of ADAPTERS) {
    const css = strip(readFileSync(join(here, 'adapters', file), 'utf8'))

    it(`${file} declares custom properties and only custom properties`, () => {
      for (const block of css.matchAll(/\{([^}]*)\}/g)) {
        for (const decl of (block[1] as string).split(';')) {
          const property = decl.split(':')[0]?.trim()
          if (!property) continue
          expect(property, `${file}: ${decl.trim()}`).toMatch(/^--/)
        }
      }
    })

    it(`${file} maps INTO --tl-*, never out of it`, () => {
      for (const property of declared(css)) expect(property, file).toMatch(/^--tl-/)
    })

    it(`${file} maps only hooks the timeline reads`, () => {
      for (const property of declared(css)) expect([...hooks], `${file}: ${property}`).toContain(property)
    })

    it(`${file} declares no position, layer, offset or viewport unit either`, () => {
      expect(css.match(/\b\d[\d.]*(?:vh|vw|vmin|vmax|dvh|svh|lvh|dvw|svw|lvw)\b/g)).toBeNull()
      expect(css.match(/(?:^|[;{])\s*(?:position|z-index|inset|top|right|bottom|left)\s*:/g)).toBeNull()
    })
  }
})

/** Names an adapter reads out of its HOST (not our own hooks, not our own roles). */
const hostTokens = (css: string): string[] =>
  [...used(css)].filter((t) => !t.startsWith('--tl-') && !t.startsWith('--_'))

group('the bundled adapter is self-contained', () => {
  // `default.css` is the package's own palette, not a bridge into someone else's
  // design system, so it must not reach for a token it does not itself define.
  // A host writing its own adapter maps ITS names into `--tl-*`; the test above
  // ("maps only hooks the timeline reads") is the rule that adapter has to meet.
  it('default.css is its own palette — it reads no host token at all', () => {
    expect(hostTokens(strip(readFileSync(join(here, 'adapters', 'default.css'), 'utf8')))).toEqual([])
  })
})
