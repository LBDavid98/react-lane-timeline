import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The shell is a dev surface, not a deployed service: `pnpm dev` and nothing else.
// `base` is relative so a built copy can be served from any path.
export default defineConfig({
  base: './',
  plugins: [react()],
  // The package is a workspace link with its own devDependency React; dedupe so the
  // shell and the component share one copy (two Reacts break hooks).
  resolve: { dedupe: ['react', 'react-dom'] },
  build: { outDir: 'dist', emptyOutDir: true },
})
