import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 与其它 views 测试同一范式：直接校验纯函数与页面结构。
import test from 'node:test'
import { buildInvoiceDocumentItems, resolveInvoiceDocumentContentUrl } from '../../src/views/workbenches/invoices/invoice-document.logic'

async function readPageSource(name: 'records' | 'approval'): Promise<string> {
  return readFile(new URL(`../../src/views/workbenches/invoices/${name}/index.vue`, import.meta.url), 'utf8')
}

test('发票照片列：缩略变体进列表、原件进预览、无照片返回空组', () => {
  assert.equal(buildInvoiceDocumentItems({ id: 'abc', documentMediaAssetId: null }, '发票照片').length, 0)
  const items = buildInvoiceDocumentItems({ id: 'abc', documentMediaAssetId: 'asset-1' }, '发票照片')
  assert.equal(items.length, 1)
  assert.equal(items[0]?.src, '/api/invoice-requests/abc/document?variant=thumb')
  assert.equal(items[0]?.previewSrc, '/api/invoice-requests/abc/document')
  assert.equal(items[0]?.key, 'abc')
  assert.equal(items[0]?.alt, '发票照片')
  // id 必须整体编码，不能把路径分隔符带进内容路径。
  assert.equal(resolveInvoiceDocumentContentUrl('a/b c'), '/api/invoice-requests/a%2Fb%20c/document')
})

test('详情抽屉按 2026-10-15 结构图重组：五节 + 节点四组 + 复用现有展示组件', async () => {
  const source = await readFile(new URL('../../src/views/workbenches/invoices/invoice-request-detail-drawer.vue', import.meta.url), 'utf8')
  for (const key of ['detail.sectionBasic', 'detail.sectionInvoice', 'detail.sectionRecipient', 'detail.sectionSettle', 'detail.sectionFlow']) {
    assert.ok(source.includes(key), `抽屉缺少 ${key}`)
  }
  // 节点四组「人 + 时间」的操作人从流程历史派生（NOTIFY/UPLOAD_DOCUMENT/SETTLE 取最近一条）。
  for (const action of ['actor(\'NOTIFY\')', 'actor(\'UPLOAD_DOCUMENT\')', 'actor(\'SETTLE\')']) {
    assert.ok(source.includes(action), `抽屉缺少节点派生 ${action}`)
  }
  // 金额与人员必须复用展示组件；照片升级为可点击放大；未结算时给占位而不是隐藏整块。
  assert.match(source, /import AmountDisplay from '@\/components\/base\/AmountDisplay\/index\.vue'/u)
  assert.match(source, /import QsPersonDisplay from '@\/components\/business\/QsPersonDisplay\/index\.vue'/u)
  assert.match(source, /<FaImagePreview/u)
  assert.match(source, /detail\.settleNone/u)
  // 结构图里没有的旧分区标题不得回归。
  assert.equal(source.includes('form.remarkSection'), false)
  assert.equal(source.includes('detail.history\''), false)
})

test('两张列表的列与口径符合 2026-10-15 拍板：照片用 ImageGroup、无明细摘要/可结算/提交人独立列', async () => {
  for (const name of ['records', 'approval'] as const) {
    const source = await readPageSource(name)
    // 展示组件必须显式导入：漏掉会被当成原生标签静默渲染成空白。
    assert.match(source, /import ImageGroup from '@\/components\/base\/ImageGroup\/index\.vue'/u)
    assert.match(source, /buildInvoiceDocumentItems/u)
    for (const slot of ['#cell-document', '#cell-buyer', '#cell-salesAmount', '#cell-taxAmount', '#cell-recipient']) {
      assert.ok(source.includes(slot), `${name} 缺少 ${slot}`)
    }
    // 两个备注列走 accessorFn + cellClass，不需要额外插槽。
    assert.match(source, /id: 'invoiceRemark'/u, `${name} 缺少发票备注列`)
    assert.match(source, /id: 'internalRemark'/u, `${name} 缺少申请单备注列`)
    // 拍板删除的列不得回归。
    assert.equal(source.includes('#cell-lineSummary'), false, `${name} 不应再显示明细摘要列`)
    assert.equal(source.includes('#cell-settleable'), false, `${name} 不应再显示可结算列`)
  }
  const approval = await readPageSource('approval')
  assert.equal(approval.includes('#cell-creatorName'), false, '审批页提交人并入提交时间列')
  // R12.2 的剩余时间落点：结算按钮禁用并以 tooltip 展示等待提示。
  assert.match(approval, /FaTooltip[\s\S]{0,400}row\.status === 'ISSUED'[\s\S]{0,400}settleHint\(row\)/u)
  assert.match(approval, /:disabled="!canSettleRow\(row\)"/u)
})
