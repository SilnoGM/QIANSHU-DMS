import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 两个独立页面文件需要各自被回归检查覆盖。
import test from 'node:test'

const PAGES = [
  ['运营工作台', new URL('../../src/views/operations/machine-viewings/index.vue', import.meta.url)],
  ['采运工作台', new URL('../../src/views/workbenches/machine-viewings/index.vue', import.meta.url)],
] as const

const FEEDBACK_MODALS = [
  ['运营工作台', new URL('../../src/views/operations/machine-viewings/machine-viewing-feedback-modal.vue', import.meta.url)],
  ['采运工作台', new URL('../../src/views/workbenches/machine-viewings/machine-viewing-feedback-modal.vue', import.meta.url)],
] as const

const DETAIL_DRAWERS = [
  ['运营工作台', new URL('../../src/views/operations/machine-viewings/machine-viewing-detail-drawer.vue', import.meta.url)],
  ['采运工作台', new URL('../../src/views/workbenches/machine-viewings/machine-viewing-detail-drawer.vue', import.meta.url)],
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

test('状态列、反馈列与人员显示按约定接入', () => {
  for (const [label, url] of PAGES) {
    const source = readFileSync(url, 'utf8')
    assert.match(source, /id:\s*'status'/u, `${label}：缺少状态列`)
    assert.match(source, /id:\s*'feedback'/u, `${label}：缺少反馈列`)
    assert.match(source, /id:\s*'submitted'/u, `${label}：提交人与时间必须合并为一列`)
    // 合并后不应再保留两个独立列。
    assert.doesNotMatch(source, /id:\s*'createdBy'/u, label)
    assert.doesNotMatch(source, /id:\s*'createdAt'/u, label)
    assert.match(source, /QsPersonDisplay/u, `${label}：提交人必须使用人员显示组件`)
    assert.match(source, /machineViewing\.feedback\.view/u, label)
    assert.match(source, /machineViewing\.feedback\.none/u, label)
    assert.match(source, /machineViewingStatusMeta/u, label)
  }
})

test('反馈弹窗只读：不渲染任何输入控件', () => {
  for (const [label, url] of FEEDBACK_MODALS) {
    const source = readFileSync(url, 'utf8')
    assert.match(source, /machineViewing\.feedback\.title/u, label)
    assert.match(source, /whitespace-pre-wrap break-words/u, `${label}：反馈正文必须保留换行`)
    assert.doesNotMatch(source, /FaTextarea|FaInput|FaForm\b/u, `${label}：反馈弹窗不应包含输入控件`)
  }
})

test('反馈列排在提交人之前，并提供操作列的查看详情入口', () => {
  for (const [label, url] of PAGES) {
    const source = readFileSync(url, 'utf8')
    assert.ok(
      source.indexOf(`id: 'feedback'`) < source.indexOf(`id: 'submitted'`),
      `${label}：反馈列必须排在提交人 / 时间之前`,
    )
    assert.match(source, /#actions=/u, `${label}：缺少操作列插槽`)
    assert.match(source, /machineViewing\.action\.detail/u, `${label}：操作列需要查看详情按钮`)
    assert.match(source, /MachineViewingDetailDrawer/u, `${label}：缺少详情抽屉`)
  }
})

test('详情抽屉完整展示反馈正文且只读', () => {
  for (const [label, url] of DETAIL_DRAWERS) {
    const source = readFileSync(url, 'utf8')
    assert.match(source, /QsGenericDrawer/u, label)
    assert.match(source, /machineViewing\.detail\.feedback/u, `${label}：缺少反馈信息分区`)
    assert.match(source, /formatMachineViewingFullTime/u, `${label}：详情抽屉必须显示含年份的完整日期`)
    assert.match(source, /whitespace-pre-wrap break-words/u, `${label}：反馈正文必须保留换行`)
    assert.doesNotMatch(source, /FaTextarea|FaInput|FaForm\b/u, `${label}：详情抽屉不应包含输入控件`)
  }
})
