import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 图片剪贴板必须在点击手势内同步写入已生成 PNG。
import test from 'node:test'
import { copyPurchaseOrderImageToClipboard, PurchaseOrderImageClipboardError } from '../../src/views/operations/purchase-orders/purchase-order-image-copy.logic'

class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}

  get types(): readonly string[] {
    return Object.keys(this.items)
  }
}

function clipboardFixture() {
  const writes: FakeClipboardItem[][] = []
  const clipboard = {
    write: async (items: FakeClipboardItem[]) => {
      writes.push(items)
    },
  }
  const createClipboardItem = (items: Record<string, Blob | Promise<Blob>>) => new FakeClipboardItem(items)
  return { clipboard, createClipboardItem, writes }
}

function hasCode(code: 'FAILED' | 'UNAVAILABLE') {
  return (error: unknown) => error instanceof PurchaseOrderImageClipboardError && error.code === code
}

test('使用已生成的 PNG Blob 写入剪贴板，不等待网络或重新渲染', async () => {
  const fixture = clipboardFixture()
  const blob = new Blob(['png'], { type: 'image/png' })
  await copyPurchaseOrderImageToClipboard(blob, fixture)
  assert.equal(fixture.writes.length, 1)
  const item = fixture.writes[0]![0]!
  assert.deepEqual(item.types, ['image/png'])
  assert.equal(item.items['image/png'], blob)
})

test('非 PNG 或缺失类型的 Blob 归一化为 image/png，空 Blob 直接失败', async () => {
  const fixture = clipboardFixture()
  const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' })
  await copyPurchaseOrderImageToClipboard(jpeg, fixture)
  const item = fixture.writes[0]![0]!
  const normalized = item.items['image/png']
  assert.ok(normalized instanceof Blob)
  assert.equal(normalized.type, 'image/png')

  const empty = new Blob([], { type: 'image/png' })
  await assert.rejects(copyPurchaseOrderImageToClipboard(empty, fixture), hasCode('FAILED'))
  assert.equal(fixture.writes.length, 1, '空图片不能写入剪贴板')
})

test('浏览器缺少 ClipboardItem 或 write 时返回明确的不可用错误', async () => {
  const fixture = clipboardFixture()
  const blob = new Blob(['png'], { type: 'image/png' })
  await assert.rejects(
    copyPurchaseOrderImageToClipboard(blob, { createClipboardItem: fixture.createClipboardItem }),
    hasCode('UNAVAILABLE'),
  )
  await assert.rejects(
    copyPurchaseOrderImageToClipboard(blob, { clipboard: fixture.clipboard }),
    hasCode('UNAVAILABLE'),
  )
  assert.deepEqual(fixture.writes, [])
})

test('剪贴板拒绝或 ClipboardItem 构造异常时返回失败，不冒充不可用', async () => {
  const rejecting = clipboardFixture()
  rejecting.clipboard.write = async () => {
    throw new Error('Permission denied')
  }
  const blob = new Blob(['png'], { type: 'image/png' })
  await assert.rejects(copyPurchaseOrderImageToClipboard(blob, rejecting), hasCode('FAILED'))

  await assert.rejects(
    copyPurchaseOrderImageToClipboard(blob, {
      clipboard: rejecting.clipboard,
      createClipboardItem: () => {
        throw new Error('ClipboardItem unavailable')
      },
    }),
    hasCode('FAILED'),
  )
})
