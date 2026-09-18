import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 费用草稿校验与本地图片生命周期使用 Node.js runner。
import test from 'node:test'
import { validatePackagingCost } from '../../src/views/operations/warehouse-arrivals/packaging-cost.logic'
import { createPackagingImagePreview } from '../../src/views/operations/warehouse-arrivals/packaging-image-preview'

const photo = (type = 'image/png', size = 8) => new File([new Uint8Array(size)], 'proof.png', { type })
const validInput = () => ({ packagingTypeValue: 'WOODEN_BOX', vendor: 'CHENGXIN', amount: '12.3', packagingImages: [photo()], quotationImages: [photo()], remark: '  已确认  ' })

test('必填项与金额错误分别定位到字段，不能生成提交草稿', () => {
  const result = validatePackagingCost({ ...validInput(), packagingTypeValue: null, vendor: null, amount: null, packagingImages: [], quotationImages: [] })
  assert.equal(result.draft, null)
  assert.deepEqual(result.errors, { packagingTypeValue: 'requiredPackagingType', vendor: 'requiredVendor', amount: 'requiredAmount', packagingImages: 'requiredImages', quotationImages: 'requiredImages' })
  for (const amount of ['0', '-1', '0.001', '1e2', 'NaN', '1,000', ' 2 ']) {
    assert.equal(validatePackagingCost({ ...validInput(), amount }).errors.amount, 'invalidAmount', amount)
  }
})

test('提交规范化金额、厂商、备注，保留原始 File 和顺序，固定 CNY', () => {
  const input = validInput()
  const result = validatePackagingCost(input)
  assert.deepEqual(result.errors, {})
  assert.deepEqual(result.draft, { packagingTypeValue: 'WOODEN_BOX', vendor: 'CHENGXIN', amount: '12.30', currency: 'CNY', packagingImages: input.packagingImages, quotationImages: input.quotationImages, remark: '已确认' })
  assert.equal(result.draft?.packagingImages[0], input.packagingImages[0])
  assert.equal(validatePackagingCost({ ...input, remark: ' ' }).draft?.remark, null)
})

test('其他厂商至少提供一种扫码收款资料，不要求厂商名称', () => {
  const paymentRecipients = [{ paymentMethod: 'ALIPAY' as const, recipientName: '  包装收款人 ', qrMediaAssetId: 'qr' }]
  assert.equal(validatePackagingCost({ ...validInput(), vendor: 'OTHER' }).errors.paymentRecipients, 'invalidRecipients')
  assert.equal(validatePackagingCost({ ...validInput(), vendor: 'OTHER', paymentRecipients: [{ ...paymentRecipients[0]!, qrMediaAssetId: null }] }).draft, null)
  assert.equal(validatePackagingCost({ ...validInput(), vendor: 'OTHER', paymentRecipients: [{ paymentMethod: 'BANK_TRANSFER', recipientName: '收款人', bankName: '银行', bankAccount: '123' }] }).draft, null)
  const result = validatePackagingCost({ ...validInput(), vendor: 'OTHER', paymentRecipients })
  assert.deepEqual(result.errors, {})
  assert.equal(result.draft?.vendor, 'OTHER')
  assert.equal(result.draft?.paymentRecipients?.[0]?.recipientName, '包装收款人')
  assert.equal(validatePackagingCost({ ...validInput(), paymentRecipients }).draft?.paymentRecipients, undefined)
})

test('两组截图各限 1 张 jpeg/png/webp、10 MiB，备注限制 500 字', () => {
  for (const field of ['packagingImages', 'quotationImages'] as const) {
    assert.equal(validatePackagingCost({ ...validInput(), [field]: [photo(), photo()] }).errors[field], 'tooManyImages')
    assert.equal(validatePackagingCost({ ...validInput(), [field]: [photo('image/gif')] }).errors[field], 'invalidImageType')
    assert.equal(validatePackagingCost({ ...validInput(), [field]: [photo('image/png', 10 * 1024 * 1024 + 1)] }).errors[field], 'imageTooLarge')
    assert.equal(validatePackagingCost({ ...validInput(), [field]: [photo('image/webp', 10 * 1024 * 1024)] }).draft !== null, true)
  }
  assert.equal(validatePackagingCost({ ...validInput(), remark: '字'.repeat(501) }).errors.remark, 'remarkTooLong')
})

function previewFixture() {
  const revoked: string[] = []
  const errors: Array<string | null> = []
  let sequence = 0
  const preview = createPackagingImagePreview({ createObjectURL: () => `blob:${++sequence}`, revokeObjectURL: url => revoked.push(url), onError: error => errors.push(error) })
  return { preview, revoked, errors }
}

test('移除图片释放 URL 并允许重新选择；关闭/卸载释放新图且只释放一次', () => {
  const { preview, revoked } = previewFixture()
  const first = photo()
  const second = photo('image/jpeg')
  const a = preview.afterUpload(preview.httpRequest({ file: first }))
  preview.sync([a])
  preview.sync([])
  assert.deepEqual(revoked, [a])
  const b = preview.afterUpload(preview.httpRequest({ file: second }))
  preview.sync([b])
  assert.deepEqual(preview.files([b]), [second])
  preview.dispose()
  preview.dispose()
  assert.deepEqual(revoked, [a, b])
  assert.deepEqual(preview.files([a, b]), [])
})

test('首次校验与真正处理之间关闭，或响应回来之前关闭，都不复活图片', async () => {
  const f = previewFixture()
  const file = photo()
  assert.equal(f.preview.beforeUpload(file), true)
  f.preview.dispose()
  const response = await f.preview.httpRequest({ file })
  assert.equal(f.preview.afterUpload(response), '')
  assert.deepEqual(f.revoked, [])
  const second = previewFixture()
  const pending = second.preview.httpRequest({ file })
  second.preview.dispose()
  assert.equal(second.preview.afterUpload(await pending), '')
  assert.deepEqual(second.revoked, ['blob:1'])
})

test('并发图片数量仍受限制；错误钩子返回失败而不抛未处理 Promise', async () => {
  const { preview, errors } = previewFixture()
  assert.equal(preview.beforeUpload(photo('image/svg+xml')), false)
  assert.equal(errors.at(-1), 'invalidImageType')
  const urls = await Promise.all(Array.from({ length: 2 }, async () => preview.afterUpload(await preview.httpRequest({ file: photo() }))))
  assert.equal(urls.filter(Boolean).length, 1)
  assert.equal(errors.at(-1), 'tooManyImages')
  const failure = createPackagingImagePreview({
    createObjectURL: () => {
      throw new Error('denied')
    },
    revokeObjectURL: () => {},
    onError: error => errors.push(error),
  })
  assert.equal(failure.afterUpload(await failure.httpRequest({ file: photo() })), '')
  assert.equal(errors.at(-1), 'previewFailed')
  preview.dispose()
})
