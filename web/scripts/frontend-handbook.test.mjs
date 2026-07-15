/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const handbookPath = `${projectRoot}/docs/前端文档/前端开发手册/README.md`
const documentIndexPath = `${projectRoot}/docs/文档索引.md`

/**
 * 入口文档是正式开发依据，缺失时必须直接失败，不能用空内容继续断言。
 * 明确报告绝对路径可以让本地开发与 CI 都快速定位文档搬移或漏提交问题。
 */
function readRequiredFile(filePath) {
  assert.equal(existsSync(filePath), true, `缺少前端开发手册资产：${filePath}`)
  return readFileSync(filePath, 'utf8')
}

test('前端开发手册入口固定正式应用、技术基线与组件职责', () => {
  const handbook = readRequiredFile(handbookPath)
  const documentIndex = readRequiredFile(documentIndexPath)

  assert.ok(
    documentIndex.includes('./前端文档/前端开发手册/README.md'),
    '根文档索引必须收录前端开发手册入口',
  )
  assert.ok(
    handbook.includes('Fantastic-admin 专业版 `6.3.0`'),
    '手册必须固定 Fantastic-admin 专业版基线',
  )
  assert.ok(
    handbook.includes('`@arco-design/web-vue@2.58.0`'),
    '手册必须固定 Arco Design Vue 依赖基线',
  )
  assert.match(handbook, /web\/apps\/qsmds-arco/u, '手册必须标明唯一正式业务应用')
  assert.match(handbook, /Fantastic-admin 内置组件/u, '手册必须说明框架内置组件职责')
  assert.match(handbook, /Arco Design Vue/u, '手册必须说明标准业务 UI 职责')
})
