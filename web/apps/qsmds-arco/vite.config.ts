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

/**
 * 读取同目录的 `.env.<mode>.example` 公开模板。
 *
 * `web/.gitignore` 有意忽略所有真实 env 文件（公开契约就是这些模板），因此 CI 与全新克隆里
 * 只有模板。模板值缺失会直接坏掉页面身份：index.html/loading.html 的 `%VITE_APP_TITLE%` 原样保留，
 * `import.meta.env.VITE_APP_TITLE` 被内联成 undefined（标签页标题显示 "undefined"）。
 */
function readAppEnvTemplate(mode: string): Record<string, string> {
  const templatePath = path.resolve(__dirname, `.env.${mode}.example`)
  if (!fs.existsSync(templatePath)) {
    return {}
  }

  const entries: Record<string, string> = {}
  for (const rawLine of fs.readFileSync(templatePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) {
      continue
    }
    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }
    const key = line.slice(0, separatorIndex).trim()
    if (key === '') {
      continue
    }
    entries[key] = line.slice(separatorIndex + 1).trim()
  }
  return entries
}

/**
 * 把模板默认值补进进程环境。
 *
 * 真实 env 文件或进程环境已定义的键一律不动，因此本地覆盖仍然生效；只有"完全缺失"的键才回落到模板。
 * 时序很重要：必须在 Vite 内部解析 env（resolveConfig → loadEnv）之前写入，带 VITE_ 前缀的进程环境变量
 * 会被 loadEnv 以最高优先级并入配置环境，于是 `import.meta.env.*`、`import.meta.env` 对象访问与
 * HTML 的 `%VAR%` 替换三条路径拿到同一份值。
 */
function applyAppEnvTemplateDefaults(
  mode: string,
  fileEnv: Record<string, string>,
): Record<string, string> {
  const injected: Record<string, string> = {}
  for (const [key, value] of Object.entries(readAppEnvTemplate(mode))) {
    if (fileEnv[key] !== undefined || process.env[key] !== undefined) {
      continue
    }
    process.env[key] = value
    injected[key] = value
  }
  return injected
}

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const fileEnv = loadEnv(mode, process.cwd())
  const env = parseLoadedEnv({ ...fileEnv, ...applyAppEnvTemplateDefaults(mode, fileEnv) })
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
        '@zumer/snapdom',
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
