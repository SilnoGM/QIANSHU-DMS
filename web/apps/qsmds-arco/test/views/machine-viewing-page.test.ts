import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 两个独立页面文件需要各自被回归检查覆盖。
import test from 'node:test'

const PAGES = [
  ['运营工作台', new URL('../../src/views/operations/machine-viewings/index.vue', import.meta.url)],
  ['采运工作台', new URL('../../src/views/workbenches/machine-viewings/index.vue', import.meta.url)],
] as const

test('预约编号列排在表格最前，并支持点击文字复制', () => {
  for (const [label, url] of PAGES) {
    const source = readFileSync(url, 'utf8')
    assert.match(source, /id:\s*'appointmentNo'[\s\S]*?copyable:\s*true[\s\S]*?copyMode:\s*'text'/u, label)
    assert.ok(
      source.indexOf(`id: 'appointmentNo'`) < source.indexOf(`id: 'appointmentTime'`),
      `${label}：编号列必须在预约时间之前`,
    )
  }
})

test('提交成功后先释放 busy 再关闭弹窗，避免受控关闭被拒绝', () => {
  for (const [label, url] of PAGES) {
    const source = readFileSync(url, 'utf8')
    // QsGenericModal 在 submitting 期间会拒绝受控关闭并回写 true；顺序反过来弹窗关不掉。
    assert.match(
      source,
      /creating\.value = false\n\s+await nextTick\(\)\n\s+open\.value = false/u,
      `${label}：必须先释放 submitting 再关闭弹窗`,
    )
  }
})
