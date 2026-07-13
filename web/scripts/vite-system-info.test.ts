import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 `tsx --test` 直接运行，不引入额外测试框架。
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(scriptsDirectory, '..')
const appRoot = path.join(webRoot, 'apps', 'qsmds-arco')
const viteConfigUrl = pathToFileURL(path.join(appRoot, 'vite.config.ts')).href

test('Vite system info 注入正式应用产品版本且不改变父进程 cwd', async () => {
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
        process.stdout.write('QIANSHU_SYSTEM_INFO=' + config.define.__SYSTEM_INFO__)
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
  const marker = 'QIANSHU_SYSTEM_INFO='
  const markerOffset = stdout.lastIndexOf(marker)

  assert.notEqual(markerOffset, -1, '子进程必须输出可解析的 system info')
  const systemInfo = JSON.parse(stdout.slice(markerOffset + marker.length))
  assert.equal(systemInfo.pkg.version, appManifest.version)
  assert.equal(process.cwd(), parentWorkingDirectory)
})
