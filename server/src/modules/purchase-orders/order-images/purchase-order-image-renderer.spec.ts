import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

import type { PurchaseOrderImageSnapshot } from './purchase-order-image-snapshot'

// Pango 使用原生 getenv；Jest 的 VM process.env 与真实服务不等价。子进程执行真实源码，
// 验证首次渲染也能找到随包中文字体，同时不让 Fontconfig 的全局缓存污染其他测试。
const renderScript = `
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true } }).outputText, filename);
const { PurchaseOrderImageRenderer } = require(process.argv[1]);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
new PurchaseOrderImageRenderer().render(input.snapshot, new Map(input.images.map(([id, bytes]) => [id, Buffer.from(bytes, 'base64')]))).then(bytes => process.stdout.write(JSON.stringify({ image: bytes.toString('base64') }))).catch(error => process.stdout.write(JSON.stringify({ code: error.code })));
`

function render(snapshot: PurchaseOrderImageSnapshot, images: ReadonlyMap<string, Buffer> = new Map()): Promise<Buffer> {
  return Promise.resolve().then(() => {
    const environment = { ...process.env }
    delete environment.FONTCONFIG_FILE
    const result = spawnSync(process.execPath, ['-e', renderScript, resolve(__dirname, 'purchase-order-image-renderer.ts')], {
      cwd: resolve(__dirname, '../../../..'), env: environment, encoding: 'utf8', timeout: 15_000, maxBuffer: 20 * 1024 * 1024,
      input: JSON.stringify({ snapshot, images: [...images].map(([id, bytes]) => [id, bytes.toString('base64')]) }),
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(result.stderr)
    const output = JSON.parse(result.stdout) as { image?: string, code?: string }
    if (output.code) throw Object.assign(new Error(output.code), { code: output.code })
    if (!output.image) throw new Error('Missing generated image')
    return Buffer.from(output.image, 'base64')
  })
}

function snapshot(): PurchaseOrderImageSnapshot {
  return {
    templateVersion: '5', purchaseOrderId: 'order-1', orderNo: 'PO/20260915-00001', orderDate: '2026-09-15', currencyCode: 'CNY', supplierName: '千树设备有限公司', purchaserName: '采购经办人',
    shippingMarkText: 'TEST/20260915-0001', shippingMarkSuffix: '李华-赖文寿', purchaseTotalAmount: '1234.5600', depositDueAmount: '234.5600', balanceDueAmount: '1000.0000', remark: '请按货件分别包装。',
    lines: [{ id: 'line-1', lineNumber: 1, productNo: 'PROD/00001', productName: '环保设备', attributes: ['颜色：绿色'], description: '请附带说明书', mainImageId: null, quantity: 2, unitPrice: '617.2800', amount: '1234.5600' }],
    parts: [{ id: 'part-1', shipmentNo: 'PKG/20260915-00001', partNumber: 1, shippingMarkText: 'TEST/20260915-0001', items: [{ purchaseOrderLineId: 'line-1', quantity: 2 }] }],
  }
}

describe('PurchaseOrderImageRenderer', () => {
  // 一项断言包含多次独立进程的真实中文排版；全套并行检查时不使用默认 5 秒限时。
  // 每次子进程仍保留上方 15 秒硬超时，防止字体或渲染异常无限等待。
  jest.setTimeout(30_000)
  const renderer = { render }

  it('renders a deterministic white PNG with bundled Chinese typography without relying on host fonts', async () => {
    const font = await readFile(resolve(__dirname, '../../../../deploy/fonts/noto-sans-sc/NotoSansSC.ttf'))
    expect(createHash('sha256').update(font).digest('hex')).toBe('a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da')
    const input = { ...snapshot(), supplierName: '千树设备' }
    const image = await renderer.render(input)
    expect(await sharp(image).metadata()).toMatchObject({ format: 'png', width: 2100, height: 2970, density: 254, hasAlpha: false })
    expect(await sharp(image).extract({ left: 0, top: 2900, width: 2100, height: 70 }).raw().toBuffer()).toEqual(Buffer.alloc(2100 * 70 * 3, 255))
    expect(await sharp(image).extract({ left: 0, top: 0, width: 20, height: 20 }).raw().toBuffer()).toEqual(Buffer.alloc(1200, 255))
    expect(await renderer.render(input)).toEqual(image)
    // 不同汉字必须产生不同像素，防止部署缺字体时全都退化成相同方块。
    const other = await renderer.render({ ...input, supplierName: '仓储物流' })
    expect(other).not.toEqual(image)
  })

  it('keeps the A4 page for multiline Chinese and escapes user-provided Pango markup', async () => {
    const original = snapshot()
    const short = await renderer.render(original)
    const long = await renderer.render({ ...original, remark: '采购说明<&>\n'.repeat(6), lines: original.lines.map(line => ({ ...line, productName: '超长中文产品名称'.repeat(4), description: '<span size="999999">literal</span> & 正常说明' })) })
    expect(await sharp(long).metadata()).toMatchObject({ width: 2100, height: 2970 })
    expect(long).not.toEqual(short)
    expect(long.byteLength).toBeLessThan(10 * 1024 * 1024)
  })

  it('contains supplied product pictures and fails when a linked picture is unavailable or invalid', async () => {
    const input = { ...snapshot(), lines: snapshot().lines.map(line => ({ ...line, mainImageId: 'photo-1' })) }
    const red = await sharp({ create: { width: 160, height: 160, channels: 3, background: '#ff0000' } }).png().toBuffer()
    const image = await renderer.render(input, new Map([['photo-1', red]]))
    const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true })
    let redPixels = 0
    for (let i = 0; i < data.length; i += info.channels) if (data[i] > 240 && data[i + 1] < 10 && data[i + 2] < 10) redPixels++
    expect(redPixels).toBeGreaterThan(5000)
    await expect(renderer.render(input)).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_PRODUCT_IMAGE_UNAVAILABLE' })
    await expect(renderer.render(input, new Map([['photo-1', Buffer.from('invalid')]]))).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_PRODUCT_IMAGE_UNAVAILABLE' })
  })

  it('extends long documents below A4 at the same width without cropping or shrinking text', async () => {
    const short = await renderer.render(snapshot())
    const long = await renderer.render({ ...snapshot(), remark: '一行采购说明\n'.repeat(60) })
    const metadata = await sharp(long).metadata()
    expect(metadata).toMatchObject({ format: 'png', width: 2100, density: 254, hasAlpha: false })
    expect(metadata.height).toBeGreaterThan(2970)
    // 单据变长不改变顶部字号和缩放；A4 之后仍有完整内容而不是空白延长。
    const header = { left: 0, top: 0, width: 2100, height: 300 }
    const longHeader = await sharp(long).extract(header).raw().toBuffer()
    expect(longHeader.equals(await sharp(short).extract(header).raw().toBuffer())).toBe(true)
    const continuation = await sharp(long).extract({ left: 0, top: 2970, width: 2100, height: metadata.height - 2970 }).raw().toBuffer()
    expect(continuation.some(value => value < 200)).toBe(true)
  })

  it('grows for additional product rows while retaining an A4 minimum width', async () => {
    const input = snapshot()
    const image = await renderer.render({ ...input, lines: Array.from({ length: 15 }, (_, index) => ({ ...input.lines[0], id: `line-${index + 1}`, lineNumber: index + 1 })) })
    const metadata = await sharp(image).metadata()
    expect(metadata.width).toBe(2100)
    expect(metadata.height).toBeGreaterThan(2970)
  })

  it('rejects oversized documents instead of truncating rows or shrinking them unreadably', async () => {
    const input = snapshot()
    await expect(renderer.render({ ...input, lines: Array.from({ length: 1000 }, (_, index) => ({ ...input.lines[0], id: `line-${index}`, lineNumber: index + 1 })) })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_TOO_LARGE' })
  })
})
