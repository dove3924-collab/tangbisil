import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

declare const process: { env: Record<string, string | undefined> }

// 테스트 전용 게임: Vercel 본서버(production) 빌드에서는 숨기고, Preview·로컬에서만 보인다
const preview = process.env.VERCEL_ENV !== 'production'

export default defineConfig({
  plugins: [react()],
  define: { __PREVIEW__: JSON.stringify(preview) },
})
