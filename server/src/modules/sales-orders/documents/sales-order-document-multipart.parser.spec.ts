import { Readable } from 'node:stream'

import {
  SalesOrderDocumentMultipartParser,
  type SalesOrderDocumentMultipartRequest,
  type SalesOrderDocumentUploadInput,
} from './sales-order-document-multipart.parser'

/**
 * 用真实的 multipart 框架构造请求体：解析器的价值就在 framing 校验上，手工拼字符串会把它测成
 * 另一个实现。`FormData` + `Response` 由 Node 生成边界与分段，和浏览器/前端 axios 发出的形态一致。
 */
function requestFrom(form: FormData): SalesOrderDocumentMultipartRequest {
  const response = new Response(form)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    throw new Error('Expected a multipart body')
  }
  const stream = Readable.fromWeb(response.body as never)
  return Object.assign(stream, { headers: { 'content-type': contentType } })
}

function fileForm(overrides: {
  readonly extraFields?: Readonly<Record<string, string>>
  readonly file?: Blob | null
  readonly mediaType?: string | null
} = {}): FormData {
  const form = new FormData()
  if (overrides.mediaType !== null) {
    form.set('mediaType', overrides.mediaType ?? 'IMAGE')
  }
  for (const [name, value] of Object.entries(overrides.extraFields ?? {})) {
    form.set(name, value)
  }
  if (overrides.file !== null) {
    form.set('file', overrides.file ?? new Blob([Buffer.from('abc')], { type: 'image/png' }), 'voucher.png')
  }
  return form
}

async function parse(form: FormData): Promise<SalesOrderDocumentUploadInput> {
  const parser = new SalesOrderDocumentMultipartParser()
  return parser.parse(requestFrom(form), input => Promise.resolve(input))
}

describe('SalesOrderDocumentMultipartParser', () => {
  it('parses a plain upload without a purpose', async () => {
    await expect(parse(fileForm())).resolves.toMatchObject({
      declaredMimeType: 'image/png',
      mediaType: 'IMAGE',
      originalFilename: 'voucher.png',
      purpose: null,
    })
  })

  it('carries the declared payment-voucher purpose through to the handler', async () => {
    await expect(parse(fileForm({ extraFields: { purpose: 'PAYMENT_VOUCHER' } })))
      .resolves.toMatchObject({ purpose: 'PAYMENT_VOUCHER' })
  })

  it.each([
    ['an unsupported purpose', { extraFields: { purpose: 'RECEIPT' } }],
    ['a lower-case purpose', { extraFields: { purpose: 'payment_voucher' } }],
    ['an unknown extra field', { extraFields: { vendor: 'acme' } }],
    ['a missing media type', { mediaType: null }],
    ['a missing file', { file: null }],
  ])('rejects %s with the fixed multipart error', async (_label, overrides) => {
    await expect(parse(fileForm(overrides))).rejects.toMatchObject({
      code: 'SALES_ORDER_DOCUMENT_MULTIPART_INVALID',
    })
  })

  it('rejects a duplicated purpose instead of guessing which one wins', async () => {
    const form = fileForm({ extraFields: { purpose: 'PAYMENT_VOUCHER' } })
    form.append('purpose', 'PAYMENT_VOUCHER')
    await expect(parse(form)).rejects.toMatchObject({
      code: 'SALES_ORDER_DOCUMENT_MULTIPART_INVALID',
    })
  })
})
