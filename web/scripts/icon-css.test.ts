import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 使用实际 UnoCSS 生成器验证动态目录在无页面提取内容时仍具备全部图标。
import test from 'node:test'
import { createGenerator } from 'unocss'
import unoConfig from '../uno.config'

test('动态图标目录的全部 Iconify 图标均通过 safelist 生成本地 SVG CSS', async () => {
  const inventory = JSON.parse(readFileSync(new URL('../apps/qsmds-arco/src/icons/project-icon-inventory.generated.json', import.meta.url), 'utf8')) as { name: string, source: string }[]
  const expectedNames = inventory.filter(icon => icon.source === 'iconify').map(icon => icon.name)
  const generator = await createGenerator(unoConfig)
  const { css, matched } = await generator.generate('', { preflights: false })
  assert.ok(expectedNames.length > 0)
  assert.deepEqual(expectedNames.filter(name => !matched.has(name)), [], '图标页动态名称不能依赖源页面是否进入构建')
  assert.match(css, /data:image\/svg\+xml/u)
  assert.doesNotMatch(css, /url\(["']?https?:/u)
})
