import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { BASE_COLORS } from '@fantastic-admin/themes'
import dayjs from 'dayjs'
import { defineConfig, loadEnv } from 'vite'
import { parseLoadedEnv } from 'vite-plugin-env-parse'
import pkg from './package.json'
import { APP_THEME_BASE_COLORS } from './src/settings.theme'
import createVitePlugins from './vite/plugins'

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = parseLoadedEnv(loadEnv(mode, process.cwd()))
  const loadingTheme = BASE_COLORS[APP_THEME_BASE_COLORS.light].light
  // 全局 scss 资源
  const scssResources: string[] = []
  fs.readdirSync('src/assets/styles/resources').forEach((dirname) => {
    if (fs.statSync(`src/assets/styles/resources/${dirname}`).isFile()) {
      scssResources.push(`@use "/src/assets/styles/resources/${dirname}" as *;`)
    }
  })
  return {
    // 开发服务器选项 https://cn.vitejs.dev/config/server-options
    server: {
      open: true,
      // 与 Server 默认 APP_ORIGIN 精确一致，避免 localhost/127.0.0.1 导致 CSRF 拒绝。
      host: '127.0.0.1',
      port: 9000,
      proxy: {
        // 根 `pnpm dev` 的正式认证链路固定使用同源 `/api`，Origin 原样转发给 Server。
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: false,
        },
        '/proxy': {
          target: env.VITE_APP_API_BASEURL,
          changeOrigin: command === 'serve' && env.VITE_ENABLE_PROXY,
          rewrite: path => path.replace(/\/proxy/, ''),
        },
      },
    },
    // 构建选项 https://cn.vitejs.dev/config/build-options
    build: {
      outDir: mode === 'production' ? 'dist' : `dist-${mode}`,
      sourcemap: env.VITE_BUILD_SOURCEMAP,
    },
    define: {
      __SYSTEM_INFO__: JSON.stringify({
        pkg: {
          name: pkg.name,
          version: pkg.version,
          dependencies: pkg.dependencies,
          devDependencies: pkg.devDependencies,
        },
        lastBuildTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      }),
    },
    plugins: createVitePlugins(mode, command === 'build', {
      version: pkg.version,
      primary: loadingTheme['--primary'],
      foreground: loadingTheme['--foreground'],
    }),
    optimizeDeps: {
      exclude: [
        '@fantastic-admin/components',
        '@fantastic-admin/composables',
      ],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '#': path.resolve(__dirname, 'src/types'),
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: scssResources.join(''),
        },
      },
    },
  }
})
