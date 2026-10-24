import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 拖放 composable 使用 Node.js 内置 runner。
import test from 'node:test'
import { nextTick, ref } from 'vue'

import { useFileDrop } from '../../../../packages/components/src/composables/use-file-drop'

interface DragEventDouble {
  readonly dataTransfer: {
    dropEffect: string
    readonly files: File[]
    readonly types: readonly string[]
  }
  readonly preventDefault: () => void
  defaultPrevented: boolean
}

function dragEvent(
  files: File[] = [],
  types: readonly string[] = ['Files'],
): DragEventDouble {
  const event: DragEventDouble = {
    dataTransfer: { dropEffect: 'none', files, types },
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true
    },
  }
  return event
}

function file(name: string, type: string): File {
  return new File(['image'], name, { type })
}

test('拖入、离开与 drop 维护拖拽态并调用 onFiles', () => {
  const received: File[][] = []
  const disabled = ref(false)
  const drop = useFileDrop({
    accept: 'image/*',
    disabled,
    onFiles: files => received.push(files),
  })
  const image = file('proof.png', 'image/png')

  const enter = dragEvent([image])
  drop.handlers.onDragenter(enter as DragEvent)
  assert.equal(enter.defaultPrevented, true)
  assert.equal(drop.isDragging.value, true)

  drop.handlers.onDragover(enter as DragEvent)
  assert.equal(enter.dataTransfer.dropEffect, 'copy')

  drop.handlers.onDragleave(enter as DragEvent)
  assert.equal(drop.isDragging.value, false)

  const dropped = dragEvent([image])
  drop.handlers.onDrop(dropped as DragEvent)
  assert.equal(dropped.defaultPrevented, true)
  assert.deepEqual(received, [[image]])
})

test('拒绝非文件拖拽、错误类型与禁用区域', () => {
  const received: File[][] = []
  const invalid: string[] = []
  const disabled = ref(false)
  const drop = useFileDrop({
    accept: 'image/png,.webp',
    disabled,
    onFiles: files => received.push(files),
    onInvalid: reason => invalid.push(reason),
  })

  const textDrag = dragEvent([], ['text/plain'])
  drop.handlers.onDragenter(textDrag as DragEvent)
  assert.equal(textDrag.defaultPrevented, false)
  assert.equal(drop.isDragging.value, false)

  const unsupported = dragEvent([file('proof.pdf', 'application/pdf')])
  drop.handlers.onDrop(unsupported as DragEvent)
  assert.deepEqual(invalid, ['type'])
  assert.deepEqual(received, [])

  disabled.value = true
  const valid = dragEvent([file('proof.png', 'image/png')])
  drop.handlers.onDrop(valid as DragEvent)
  assert.equal(valid.defaultPrevented, true)
  assert.deepEqual(received, [])
})

test('单文件区域只取第一个，多文件区域保留全部', async () => {
  const single: File[][] = []
  const multiple: File[][] = []
  const a = file('a.png', 'image/png')
  const b = file('b.png', 'image/png')
  const singleDrop = useFileDrop({ accept: 'image/*', onFiles: files => single.push(files) })
  const multipleDrop = useFileDrop({ accept: 'image/*', multiple: true, onFiles: files => multiple.push(files) })

  singleDrop.handlers.onDrop(dragEvent([a, b]) as DragEvent)
  multipleDrop.handlers.onDrop(dragEvent([a, b]) as DragEvent)
  await nextTick()
  assert.deepEqual(single, [[a]])
  assert.deepEqual(multiple, [[a, b]])
})

test('销售订单收款与签收单的拖放区覆盖可见提示文字', () => {
  const root = new URL('../../../../', import.meta.url)
  const source = readFileSync(
    new URL('apps/qsmds-arco/src/views/operations/sales-orders/sales-order-records-modal.vue', root),
    'utf8',
  )
  const paymentSection = source.match(
    /<section[^>]*aria-labelledby="payment-voucher-title"[^>]*>/u,
  )?.[0]

  assert.ok(paymentSection, '收款凭证应保留独立的 section')
  assert.match(paymentSection, /v-bind="paymentDropHandlers"/u)

  const receiptDropIndex = source.indexOf('v-bind="receiptDropHandlers"')
  const receiptHintIndex = source.indexOf('只需上传一份签收单')
  const receiptUploadIndex = source.indexOf('上传签收单', receiptDropIndex)
  assert.ok(receiptDropIndex >= 0, '签收单应接入拖放')
  assert.ok(
    receiptDropIndex < receiptHintIndex && receiptHintIndex < receiptUploadIndex,
    '签收单拖放区必须覆盖提示文字和上传入口',
  )
})

test('业务上传组件均接入共享拖放能力', () => {
  const root = new URL('../../../../', import.meta.url)
  const cases = [
    'packages/components/src/basic/image-upload/index.vue',
    'apps/qsmds-arco/src/views/operations/sales-orders/create.vue',
    'apps/qsmds-arco/src/views/operations/sales-orders/sales-order-records-modal.vue',
    'apps/qsmds-arco/src/views/operations/purchase-orders/purchase-order-document-modal.vue',
    'apps/qsmds-arco/src/views/admin/product-management/list/product-batch-image-card.vue',
    'apps/qsmds-arco/src/views/operations/personal-finance/withdrawals/fund-withdrawal-approve-modal.vue',
  ]
  for (const file of cases) {
    const source = readFileSync(new URL(file, root), 'utf8')
    assert.match(source, /useFileDrop/u, file)
  }
  const imageUpload = readFileSync(
    new URL('packages/components/src/basic/image-upload/index.vue', root),
    'utf8',
  )
  assert.match(imageUpload, /v-bind="fileDropHandlers"/u)
})
