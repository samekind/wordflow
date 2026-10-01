import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// emptyOutDir: stale bundles left in dist/ were being copied into the APK (44 MB instead of 8 MB).
export default defineConfig({ plugins: [react()], build: { emptyOutDir: true } })
