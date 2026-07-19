import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 `tsx --test` 直接运行，不引入额外测试框架。
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { BASE_COLORS } from '@fantastic-admin/themes'
import appSettings from '../apps/qsmds-arco/src/settings'
import { APP_THEME_BASE_COLORS } from '../apps/qsmds-arco/src/settings.theme'

const execFileAsync = promisify(execFile)
const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(scriptsDirectory, '..')
const appRoot = path.join(webRoot, 'apps', 'qsmds-arco')
const viteConfigUrl = pathToFileURL(path.join(appRoot, 'vite.config.ts')).href

test('Vite 注入产品版本、首屏主题且不改变父进程 cwd', async () => {
  const parentWorkingDirectory = process.cwd()
  // 正式 app 的产品 version 会随 Release 推进；测试从 manifest 动态取得期望值，
  // 只冻结 `package.json -> Vite define` 数据流，不把任一发布版本硬编码成长期契约。
  const appManifest = JSON.parse(
    await readFile(path.join(appRoot, 'package.json'), 'utf8'),
  ) as { version: string }
  // Vite 配置会按 cwd 读取应用内 SCSS 资源；使用隔离子进程既还原真实调用边界，也避免污染其他并行测试。
  const probe = `
    void import(${JSON.stringify(viteConfigUrl)})
      .then(async ({ default: configFactory }) => {
        if (typeof configFactory !== 'function') {
          throw new Error('Vite config factory is unavailable')
        }
        const config = await configFactory({
          command: 'build',
          mode: 'test',
          isSsrBuild: false,
          isPreview: false,
        })
        const plugins = config.plugins.flat(Infinity).filter(Boolean)
        const appLoadingPlugin = plugins.find(plugin => plugin.name === 'vite-plugin-app-loading')
        const loadingDataPlugin = plugins.find(plugin => plugin.name === 'qsmds-app-loading-data')
        if (!appLoadingPlugin || !loadingDataPlugin) {
          throw new Error('App loading plugins are unavailable')
        }
        const apiProxy = config.server?.proxy?.['/api']
        if (typeof apiProxy !== 'object' || apiProxy === null) {
          throw new Error('Development API proxy is unavailable')
        }

        const runHtmlTransform = async (plugin, html) => {
          const hook = plugin.transformIndexHtml
          const handler = typeof hook === 'function' ? hook : hook?.handler
          if (typeof handler !== 'function') {
            throw new Error('App loading HTML transform is unavailable')
          }
          const result = await handler(html)
          if (typeof result !== 'string') {
            throw new Error('App loading HTML transform must return a string')
          }
          return result
        }

        let transformedHtml = '<html><body></body></html>'
        transformedHtml = await runHtmlTransform(appLoadingPlugin, transformedHtml)
        transformedHtml = await runHtmlTransform(loadingDataPlugin, transformedHtml)

        process.stdout.write('QIANSHU_SYSTEM_INFO=' + config.define.__SYSTEM_INFO__ + '\\n')
        process.stdout.write('QIANSHU_DEV_SERVER=' + Buffer.from(JSON.stringify({
          apiChangeOrigin: apiProxy.changeOrigin,
          apiTarget: apiProxy.target,
          host: config.server.host,
          port: config.server.port,
        })).toString('base64') + '\\n')
        process.stdout.write('QIANSHU_LOADING_ORDER=' + loadingDataPlugin.transformIndexHtml.order + '\\n')
        process.stdout.write('QIANSHU_LOADING_HTML=' + Buffer.from(transformedHtml).toString('base64'))
      })
      .catch(() => {
        process.stderr.write('Vite system info probe failed')
        process.exitCode = 1
      })
  `

  const { stdout } = await execFileAsync(
    'pnpm',
    ['exec', 'tsx', '--eval', probe],
    {
      cwd: appRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DOTENV_CONFIG_PATH: '/dev/null',
      },
    },
  )
  const readProbeValue = (marker: string) => {
    const line = stdout.split(/\r?\n/u).findLast(item => item.startsWith(marker))
    assert.ok(line, `子进程必须输出可解析的 ${marker}`)
    return line.slice(marker.length)
  }
  const systemInfo = JSON.parse(readProbeValue('QIANSHU_SYSTEM_INFO='))
  const developmentServer = JSON.parse(Buffer.from(
    readProbeValue('QIANSHU_DEV_SERVER='),
    'base64',
  ).toString('utf8'))
  const loadingHtml = Buffer.from(
    readProbeValue('QIANSHU_LOADING_HTML='),
    'base64',
  ).toString('utf8')
  const loadingTheme = BASE_COLORS[APP_THEME_BASE_COLORS.light].light

  assert.equal(systemInfo.pkg.version, appManifest.version)
  assert.deepEqual(developmentServer, {
    apiChangeOrigin: false,
    apiTarget: 'http://127.0.0.1:3000',
    host: '127.0.0.1',
    port: 9000,
  })
  assert.equal(appSettings.theme.baseColorLight, APP_THEME_BASE_COLORS.light)
  assert.equal(appSettings.theme.baseColorDark, APP_THEME_BASE_COLORS.dark)
  assert.equal(readProbeValue('QIANSHU_LOADING_ORDER='), 'post')
  assert.match(loadingHtml, new RegExp(`v${appManifest.version.replaceAll('.', '\\.')}`, 'u'))
  assert.match(
    loadingHtml,
    new RegExp(`--loading-primary:\\s*${loadingTheme['--primary'].replaceAll('.', '\\.')}`, 'u'),
  )
  assert.match(
    loadingHtml,
    new RegExp(`--loading-foreground:\\s*${loadingTheme['--foreground'].replaceAll('.', '\\.')}`, 'u'),
  )
  assert.doesNotMatch(loadingHtml, /__QIANSHU_[A-Z_]+__/u)
  assert.equal(process.cwd(), parentWorkingDirectory)
})
