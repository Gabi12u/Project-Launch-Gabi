import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Where the reporting credentials come from.
  //
  // Not from the source code, and never again: the Discord webhook stood
  // in src/main/core/reports.ts in plain sight, and on 2026-09-08 an
  // automated scanner found it in the public repository and spammed the
  // channel. Bots grep GitHub around the clock, so anything secret-shaped
  // in a public file has a lifetime measured in minutes.
  //
  // The release workflow passes these as GitHub secrets. A gitignored
  // .env covers builds made by hand. Anything missing simply switches
  // that delivery path off, which is what every fork and every local
  // development run gets.
  const env = loadEnv(mode, process.cwd(), 'LG_')

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        'process.env.LG_REPORT_WEBHOOK': JSON.stringify(env.LG_REPORT_WEBHOOK ?? ''),
        'process.env.LG_REPORT_PANEL_TOKEN': JSON.stringify(env.LG_REPORT_PANEL_TOKEN ?? '')
      },
      resolve: {
        alias: {
          '@shared': resolve('src/shared'),
          '@main': resolve('src/main')
        }
      },
      build: {
        rollupOptions: {
          input: { index: resolve('src/main/index.ts') }
        }
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          '@shared': resolve('src/shared')
        }
      },
      build: {
        rollupOptions: {
          input: { index: resolve('src/preload/index.ts') }
        }
      }
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      plugins: [react()]
    }
  }
})
