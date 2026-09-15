/**
 * One build, three entries, code splitting on — so the model lives in ONE shared
 * chunk that both the component entry and `./model` import, rather than being
 * compiled twice.
 *
 * The `"use client"` directive is NOT an esbuild `banner`: a banner stamps every
 * output file, chunks and the react-free `./model` / `./registry` included, and a
 * directive on a shared chunk makes a server route refuse to import it. `onSuccess`
 * prepends it to exactly the entries in USE_CLIENT, on the same first line so
 * sourcemaps stay aligned. `exports.test.ts` checks both halves of that claim
 * against the real build output.
 *
 * Three entries is few enough for one dts pass (VS needed a per-entry script at 21
 * entries, where rollup-plugin-dts peaked at ~2.4 GB).
 */
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { defineConfig } from 'tsup'

/** Entries that ship a React component and so must carry the directive. */
export const USE_CLIENT = ['index'] as const

export const ENTRIES = {
  index: 'src/index.ts',
  model: 'src/model.ts',
  registry: 'src/registry.ts',
} as const

export default defineConfig({
  entry: ENTRIES,
  format: ['esm'],
  target: 'es2022',
  platform: 'browser',
  tsconfig: 'tsconfig.build.json',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: true,
  esbuildOptions(options) {
    options.jsx = 'automatic'
  },
  async onSuccess() {
    for (const name of USE_CLIENT) {
      const file = `dist/${name}.js`
      const code = await readFile(file, 'utf8')
      if (!code.startsWith('"use client";')) await writeFile(file, `"use client";${code}`)
    }
    await copyFile('src/timeline.css', 'dist/timeline.css')
    await mkdir('dist/adapters', { recursive: true })
    for (const file of await readdir('src/adapters')) {
      if (file.endsWith('.css')) await copyFile(`src/adapters/${file}`, `dist/adapters/${file}`)
    }
  },
})
