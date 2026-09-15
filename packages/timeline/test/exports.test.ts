/**
 * The published shape, checked against the BUILD (dist/). Run after `pnpm build`.
 * Mirrors a sibling package's exports test.
 *
 * - every `exports` key resolves to a file that exists
 * - the component entry starts with "use client"; `./model` and `./registry` do not,
 *   and no shared chunk does either (a directive on a chunk makes a server route
 *   refuse to import the pure model)
 * - `./model` and `./registry` pull in no react at all — server-safe
 * - the only bare imports left in the JS are the declared peer externals
 * - the stylesheet and every adapter reached dist/
 */
// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SURFACES, SURFACE_SUBPATH } from '../src/registry.js'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string
  exports: Record<string, string | { types: string; import: string }>
}
const dist = join(root, 'dist')
const built = existsSync(join(dist, 'index.js'))

const USE_CLIENT = new Set(['.'])
const NO_USE_CLIENT = new Set(['./model', './registry'])

/** Every file an entry pulls in through relative imports (its chunks). */
function closure(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen
  seen.add(file)
  const code = readFileSync(file, 'utf8')
  for (const m of code.matchAll(/(?<!["'\w])(?:from|import)\s*["'](\.\/[^"']+)["']/g)) {
    closure(join(dist, m[1] as string), seen)
  }
  return seen
}

describe('the registry', () => {
  it('lists each surface once, and every surface has an exported subpath', () => {
    expect(new Set(SURFACES).size).toBe(SURFACES.length)
    for (const surface of SURFACES) {
      expect(Object.keys(pkg.exports), surface).toContain(SURFACE_SUBPATH[surface])
    }
  })
})

describe.skipIf(!built)('the built package', () => {
  it('declares exactly the subpaths this package ships', () => {
    expect(Object.keys(pkg.exports).sort()).toEqual(
      ['.', './model', './registry', './timeline.css', './adapters/*', './package.json'].sort(),
    )
  })

  for (const [key, target] of Object.entries(pkg.exports)) {
    it(`${key} resolves to files that exist`, () => {
      if (key === './adapters/*') {
        const sources = readdirSync(join(root, 'src/adapters')).filter((f) => f.endsWith('.css'))
        expect(sources.length).toBeGreaterThan(0)
        for (const f of sources) expect(existsSync(join(dist, 'adapters', f)), f).toBe(true)
        return
      }
      const files = typeof target === 'string' ? [target] : [target.types, target.import]
      for (const f of files) expect(existsSync(join(root, f)), `${key} → ${f}`).toBe(true)
    })
  }

  for (const key of USE_CLIENT) {
    it(`${key} starts with "use client"`, () => {
      const target = pkg.exports[key] as { import: string }
      expect(readFileSync(join(root, target.import), 'utf8').startsWith('"use client";')).toBe(true)
    })
  }

  for (const key of NO_USE_CLIENT) {
    it(`${key} does not start with "use client"`, () => {
      const target = pkg.exports[key] as { import: string }
      expect(readFileSync(join(root, target.import), 'utf8')).not.toMatch(/^\s*["']use client["']/)
    })
  }

  it('no shared chunk carries a directive (only entries do)', () => {
    const entries = new Set(
      Object.values(pkg.exports).flatMap((t) => (typeof t === 'string' ? [] : [t.import.replace('./dist/', '')])),
    )
    for (const f of readdirSync(dist).filter((f) => f.endsWith('.js') && !entries.has(f))) {
      expect(readFileSync(join(dist, f), 'utf8'), f).not.toMatch(/^\s*["']use client["']/)
    }
  })

  it('./model and ./registry pull in no react at all (server-safe)', () => {
    for (const key of ['./model', './registry']) {
      const target = pkg.exports[key] as { import: string }
      for (const file of closure(join(root, target.import))) {
        expect(readFileSync(file, 'utf8'), `${key}: ${file}`).not.toMatch(/from\s*["']react/)
      }
    }
  })

  it('the only bare imports left in JS are the declared peer externals', () => {
    const allowed = /^(react|react-dom|react\/jsx-runtime)$/
    for (const f of readdirSync(dist).filter((f) => f.endsWith('.js'))) {
      const code = readFileSync(join(dist, f), 'utf8')
      for (const m of code.matchAll(/(?<!["'\w])(?:from|import)\s*["']([^"'.][^"']*)["']/g)) {
        expect(m[1], f).toMatch(allowed)
      }
    }
  })

  it('ships the stylesheet and every adapter, so a host can theme it without the source', () => {
    expect(existsSync(join(dist, 'timeline.css'))).toBe(true)
    for (const f of readdirSync(join(root, 'src/adapters'))) {
      expect(existsSync(join(dist, 'adapters', f)), f).toBe(true)
    }
  })

  it('ships declarations for every entry', () => {
    for (const name of ['index', 'model', 'registry']) {
      expect(existsSync(join(dist, `${name}.d.ts`)), name).toBe(true)
    }
  })

  it('publishes dist only — the tarball carries no source', () => {
    const files = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] }
    expect(files.files).toEqual(['dist'])
  })
})

describe('build present', () => {
  it.skipIf(built)('dist/ is missing — run `pnpm build` before `pnpm test` to check the published shape', () => {
    expect.fail('dist/ not built')
  })
})
