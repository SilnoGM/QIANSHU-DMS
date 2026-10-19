import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 静态契约与纯函数计时测试不需要浏览器环境。
import test from 'node:test'
import {
  createStartupMinimumDuration,
  useAppStartup,
} from '../../src/composables/app/startup'

function readRelativeSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('登录成功后的启动页最短停留随机在 1500-2000ms', () => {
  assert.equal(createStartupMinimumDuration(() => 0), 1500)
  assert.equal(createStartupMinimumDuration(() => 0.5), 1750)
  assert.equal(createStartupMinimumDuration(() => 1), 2000)
})

test('登录成功启动页等待导航完成后再离场', async () => {
  const startup = useAppStartup()
  let releaseNavigation: (() => void) | undefined
  const navigation = new Promise<void>((resolve) => {
    releaseNavigation = resolve
  })

  const running = startup.run(() => navigation, { minimumMs: 1 })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(startup.visible.value, true)

  releaseNavigation?.()
  await running
  assert.equal(startup.visible.value, false)
  assert.equal(startup.leaving.value, false)
})

test('登录页接入健康检查，成功/失败映射为正常/异常', () => {
  const page = readRelativeSource('../../src/views/login-collage.vue')

  assert.match(page, /getHealth/u)
  assert.match(page, /系统运行正常/u)
  assert.match(page, /系统运行异常/u)
  assert.match(page, /系统状态检测中/u)
})

test('登录成功由全局启动页承接并开始导航', () => {
  const app = readRelativeSource('../../src/App.vue')
  const page = readRelativeSource('../../src/views/login-collage.vue')

  assert.match(app, /<AppStartupSplash\b/u)
  assert.match(app, /useAppStartup/u)
  assert.match(page, /useAppStartup/u)
  assert.match(page, /runStartup/u)
})
