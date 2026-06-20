import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Bake the parent package version into the bundle so the brand badge matches the npm release
// (built together via `build:gui` in prepublishOnly). Single source = the root package.json.
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
})
