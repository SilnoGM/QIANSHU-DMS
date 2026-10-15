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
