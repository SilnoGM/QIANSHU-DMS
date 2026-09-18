import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证真实提报的附件缓存、幂等重试及会话隔离。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { usePackagingCostSubmission } from '../../src/views/operations/warehouse-arrivals/use-packaging-cost-submission'

const draft = () => ({ packagingTypeValue: 'WOODEN_BOX', vendor: 'OTHER' as const, amount: '12.30', currency: 'CNY' as const, packagingImages: [new File(['p'], 'packaging.png', { type: 'image/png' })], quotationImages: [new File(['q'], 'quote.png', { type: 'image/png' })], remark: null, paymentRecipients: [{ paymentMethod: 'ALIPAY' as const, recipientName: '收款人', qrMediaAssetId: 'qr' }] })
function fixture() {
  const enabled = ref(true)
  const epoch = ref(1)
  const id = ref('shipment')
  const uploads: string[] = []
  const writes: Array<{ body: unknown, key: string }> = []
  let write: () => Promise<unknown> = async () => ({ data: { id: 'created' } })
  let upload: (() => Promise<unknown>) | null = null
  const api = {
    uploadImage: async (file: File) => {
      uploads.push(file.name)
      return upload ? upload() : { data: { mediaAssetId: file.name } }
    },
    submit: async (body: unknown, key: string) => {
      writes.push({ body, key })
      return write()
    },
  }
  const scope = effectScope()
  const state = scope.run(() => usePackagingCostSubmission(enabled, epoch, id, api as never, () => `key-${writes.length}`))!
  return { state, enabled, epoch, id, uploads, writes, setWrite: (value: typeof write) => write = value, setUpload: (value: typeof upload) => upload = value, dispose: () => scope.stop(),
  }
}

test('连续点击仅提交一次，附件成功后未知结果重试复用原键和快照', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  const input = draft()
  let reject!: (reason: unknown) => void
  f.setWrite(() => new Promise((_, no) => reject = no))
  const first = f.state.submit(input)
  assert.equal(await f.state.submit(input), null)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.writes.length, 1)
  reject({ kind: 'network', message: 'offline' })
  assert.equal(await first, null)
  assert.equal(f.state.pending.value, true)
  input.amount = '999.00'
  input.paymentRecipients[0]!.recipientName = '被修改的收款人'
  f.setWrite(async () => ({ data: { id: 'created' } }))
  assert.equal((await f.state.submit())?.id, 'created')
  assert.equal(f.uploads.length, 2)
  assert.deepEqual(f.writes[1], f.writes[0])
  assert.equal((f.writes[1]?.body as { amount: string }).amount, '12.30')
  assert.equal((f.writes[1]?.body as { paymentRecipients: Array<{ recipientName: string }> }).paymentRecipients[0]?.recipientName, '收款人')
})

test('明确拒绝保留已上传附件，允许修正草稿后用新键提交', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  const input = draft()
  f.setWrite(async () => {
    throw Object.assign(new Error('invalid'), { status: 422 })
  })
  await f.state.submit(input)
  assert.equal(f.state.pending.value, false)
  input.amount = '20.00'
  f.setWrite(async () => ({ data: { id: 'created' } }))
  await f.state.submit(input)
  assert.equal(f.uploads.length, 2)
  assert.notEqual(f.writes[1]?.key, f.writes[0]?.key)
  assert.equal((f.writes[1]?.body as { amount: string }).amount, '20.00')
})

test('撤权和换账号后晚到上传不能写提报，晚到提交不能报告成功', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  let finish!: (value: unknown) => void
  f.setUpload(() => new Promise(resolve => finish = resolve))
  const first = f.state.submit(draft())
  f.enabled.value = false
  finish({ data: { mediaAssetId: 'late' } })
  assert.equal(await first, null)
  assert.equal(f.writes.length, 0)
  f.enabled.value = true
  f.setUpload(null)
  f.setWrite(() => new Promise(resolve => finish = resolve))
  const second = f.state.submit(draft())
  await new Promise(resolve => setImmediate(resolve))
  f.epoch.value += 1
  finish({ data: { id: 'late' } })
  assert.equal(await second, null)
  assert.equal(f.state.busy.value, false)
})

test('第二张上传失败保留第一张，重试只上传未成功的截图再提交', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  const input = draft()
  let uploads = 0
  f.setUpload(async () => {
    uploads += 1
    if (uploads === 2) {
      throw new Error('upload failed')
    }
    return { data: { mediaAssetId: `asset-${uploads}` } }
  })
  assert.equal(await f.state.submit(input), null)
  assert.equal(f.writes.length, 0)
  assert.equal(f.state.pending.value, false)
  assert.equal((await f.state.submit(input))?.id, 'created')
  assert.deepEqual(f.uploads, ['packaging.png', 'quote.png', 'quote.png'])
  assert.equal((f.writes[0]?.body as { packagingImageMediaAssetId: string }).packagingImageMediaAssetId, 'asset-1')
})
