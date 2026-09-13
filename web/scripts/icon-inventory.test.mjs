import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 图标资产与静态清单使用 Node.js 内置 runner 验证。
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildIconInventory,
  collectNavigationIcons,
  extractStaticIconNames,
  serializeInventory,
  validateBrandIcons,
  validateBrandSvg,
} from './generate-icon-inventory.mjs'

const webRoot = fileURLToPath(new URL('../', import.meta.url))
const sample = { name: 'qs-orders', label: '订单', category: '订单', usages: ['销售订单'] }

test('品牌 SVG 固定画布和调色板，拒绝脚本、嵌入内容及事件属性', () => {
  const valid = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#2FA127" stroke="#11170F" d="M1 1h20v20Z"/></svg>'
  assert.doesNotThrow(() => validateBrandSvg(valid, 'qs-orders'))
  assert.throws(() => validateBrandSvg(valid.replace('0 0 64 64', '0 0 24 24'), 'qs-orders'), /viewBox/u)
  assert.throws(() => validateBrandSvg(valid.replace('#2FA127', '#ffffff'), 'qs-orders'), /palette/iu)
  for (const unsafe of [
    '<script>alert(1)</script>',
    '<image href="https://example.com/asset.png"/>',
    '<foreignObject/>',
    '<style>path{fill:red}</style>',
    '<path onclick="alert(1)"/>',
    '<path style="fill:red"/>',
    '<use href="https://example.com/asset.svg"/>',
  ]) {
    assert.throws(() => validateBrandSvg(valid.replace('</svg>', `${unsafe}</svg>`), 'qs-orders'), /unsafe/iu)
  }
})

test('品牌标识重复和缺失 SVG 都应失败，不能向图标页提供失效资产', () => {
  assert.throws(() => validateBrandIcons([sample, sample], new Set(['qs-orders'])), /duplicate/iu)
  assert.throws(() => validateBrandIcons([sample], new Set()), /missing SVG/iu)
  assert.throws(() => validateBrandIcons([{ ...sample, name: 'bad-name' }], new Set(['bad-name'])), /qs-/iu)
  assert.doesNotThrow(() => validateBrandIcons([sample], new Set(['qs-orders'])))
})

test('静态扫描识别模板、表达式候选和 UnoCSS 状态类中的图标且排除伪前缀', () => {
  const names = extractStaticIconNames(`
    <FaIcon name="i-lucide:search" />
    <FaIcon :name="open ? 'i-ri:fullscreen-line' : 'i-ri:fullscreen-exit-line'" />
    <div class="hover:i-lucide:check i-lucide:arrow-right" />
    const invalid = 'not-i-lucide:fake'
  `)
  assert.deepEqual(names, [
    'i-lucide:arrow-right',
    'i-lucide:check',
    'i-lucide:search',
    'i-ri:fullscreen-exit-line',
    'i-ri:fullscreen-line',
  ])
})

test('实际导航全部采用已登记且存在的品牌资产，静态清单覆盖当前源码且没有漂移', () => {
  const inventory = buildIconInventory(webRoot)
  assert.ok(inventory.some(icon => icon.name === 'app-toolbar-collapse' && icon.source === 'local'))
  assert.ok(inventory.some(icon => icon.name === 'i-ri:search-line' && icon.source === 'iconify'))
  assert.ok(inventory.some(icon => icon.name === 'qs-icons' && icon.source === 'brand'))
  assert.equal(new Set(inventory.map(icon => icon.name)).size, inventory.length)
  const actual = readFileSync(new URL('../apps/qsmds-arco/src/icons/project-icon-inventory.generated.json', import.meta.url), 'utf8')
  assert.ok(actual === serializeInventory(inventory), '运行 node scripts/generate-icon-inventory.mjs 更新静态清单')
})

test('正式注册的顶部、侧边与组件库菜单全部使用品牌语义图标', () => {
  const navigation = collectNavigationIcons(webRoot)
  assert.ok(navigation.length > 50, '完整读取正式路由和组件库路由')
  assert.ok(navigation.every(icon => icon.name.startsWith('qs-')), '不能遗漏某个导航分组')
  assert.ok(navigation.some(icon => icon.name === 'qs-icons' && icon.usage === '图标库'))
})

test('路由检查沿静态导入发现漏配图标，隐藏叶子与未导入示例不要求资产', (context) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'qs-icon-routes-'))
  context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }))
  const routerRoot = path.join(fixtureRoot, 'apps/qsmds-arco/src/router')
  mkdirSync(path.join(routerRoot, 'modules'), { recursive: true })
  writeFileSync(path.join(routerRoot, 'routes.ts'), `
    import Menu from './modules/menu'
    const asyncRoutes = [{ meta: { title: '工作台', icon: 'qs-workbench' }, children: [Menu] }]
  `)
  writeFileSync(path.join(routerRoot, 'modules/unused.example.ts'), `
    const route = { meta: { title: '未注册示例' } }
  `)
  const menuFile = path.join(routerRoot, 'modules/menu.ts')
  writeFileSync(menuFile, `
    const route = { path: '/orders', meta: { title: '订单' } }
  `)
  assert.throws(() => collectNavigationIcons(fixtureRoot), /Missing static navigation icon: '订单'/u)
  writeFileSync(menuFile, `
    const route = { path: '/orders', meta: { title: '订单', icon: 'qs-orders' }, children: [
      { path: 'create', meta: { title: '新增订单', menu: false } }
    ] }
  `)
  assert.deepEqual(collectNavigationIcons(fixtureRoot).map(icon => icon.name), ['qs-orders', 'qs-workbench'])
})
