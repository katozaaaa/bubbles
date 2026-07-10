import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  base: process.env.GITHUB_ACTIONS ? '/bubbles/' : '/',
})
