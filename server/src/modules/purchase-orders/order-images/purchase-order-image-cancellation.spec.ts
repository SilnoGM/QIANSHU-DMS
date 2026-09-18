import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'

import sharp, { type Region } from 'sharp'

import type { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import { deliverCancelledPurchaseOrderImage } from './purchase-order-image-cancellation'

// 与采购单排版器测试一致：Pango 从 native getenv 读取配置，Jest 的 VM env 不等价。
// 子进程执行真实源码，验证首次盖章依赖随包中文字体，不扫描宿主字体。
const deliveryScript = `
const fs = require('node:fs');
const ts = require('typescript');
const { Readable } = require('node:stream');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true } }).outputText, filename);
const { deliverCancelledPurchaseOrderImage } = require(process.argv[1]);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
let opened = 0;
const bytes = Buffer.from(input.bytes, 'base64');
const delivery = { mode: input.mode, stat: async () => ({ sizeBytes: BigInt(bytes.length) }), open: async () => { opened++; return { stream: Readable.from(bytes) }; } };
deliverCancelledPurchaseOrderImage(delivery, { ...input.asset, sizeBytes: BigInt(input.asset.sizeBytes) }, 'image-id', input.ifNoneMatch, input.method, input.mimeType).then(async response => {
  const chunks = [];
  if (response.stream) for await (const chunk of response.stream) chunks.push(chunk);
  process.stdout.write(JSON.stringify({ status: response.status, headers: response.headers, image: response.stream ? Buffer.concat(chunks).toString('base64') : undefined, opened }));
}).catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
`

async function setup(height = 2970, format: 'png' | 'jpeg' | 'webp' = 'png', width = 2100) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .withMetadata({ density: 254 }).toFormat(format).toBuffer()
  const asset = { objectKey: `assets/2026/09/order.${format}`, checksumSha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: BigInt(bytes.length) }
  const delivery = {
    mode: 'application',
    stat: jest.fn().mockResolvedValue({ sizeBytes: asset.sizeBytes }),
    open: jest.fn().mockImplementation(() => Promise.resolve({ stream: Readable.from(bytes) })),
  }
  const callDirect = (method: 'GET' | 'HEAD' = 'GET', ifNoneMatch?: unknown) => deliverCancelledPurchaseOrderImage(
    delivery as unknown as MediaContentDeliveryService, asset, 'image-id', ifNoneMatch, method, `image/${format}`,
  )
  const call = (method: 'GET' | 'HEAD' = 'GET', ifNoneMatch?: unknown) => {
    const environment = { ...process.env }
    delete environment.FONTCONFIG_FILE
    const result = spawnSync(process.execPath, ['-e', deliveryScript, resolve(__dirname, 'purchase-order-image-cancellation.ts')], {
      env: environment, encoding: 'utf8', timeout: 20_000, maxBuffer: 30 * 1024 * 1024,
      input: JSON.stringify({ bytes: bytes.toString('base64'), asset: { ...asset, sizeBytes: String(asset.sizeBytes) }, mode: delivery.mode, method, ifNoneMatch, mimeType: `image/${format}` }),
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(result.stderr)
    const output = JSON.parse(result.stdout) as { status: number, headers: Record<string, string>, image?: string, opened: number }
    return Promise.resolve({ ...output, stream: output.image === undefined ? undefined : Readable.from(Buffer.from(output.image, 'base64')) })
  }
  return { bytes, asset, delivery, call, callDirect }
}

async function read(stream: Readable | undefined): Promise<Buffer> {
  if (!stream) throw new Error('Missing image stream')
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid image stream')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function redPixels(bytes: Buffer, region: Region): Promise<number> {
  const { data, info } = await sharp(bytes).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let count = 0
  for (let index = 0; index < data.length; index += info.channels) {
    if (data[index] > 180 && data[index + 1] < 150 && data[index + 2] < 150) count++
  }
  return count
}

describe('cancelled purchase order image delivery', () => {
  jest.setTimeout(30_000)
  it('burns a red void stamp into the image, retains A4 dimensions and leaves original bytes unchanged', async () => {
    const fixture = await setup()
    const original = Buffer.from(fixture.bytes)
    const response = await fixture.call()
    const image = await read(response.stream)
    expect(response.status).toBe(200)
    expect(response.headers).toMatchObject({ 'Content-Type': 'image/png', 'Content-Length': String(image.length), 'X-Content-Type-Options': 'nosniff' })
    expect(response.headers['Content-Disposition']).toContain('-cancelled.png')
    expect(await sharp(image).metadata()).toMatchObject({ width: 2100, height: 2970, density: 254 })
    expect(await redPixels(image, { left: 0, top: 0, width: 2100, height: 1500 })).toBeGreaterThan(10_000)
    expect(await sharp(image).extract({ left: 0, top: 0, width: 50, height: 50 }).removeAlpha().raw().toBuffer()).toEqual(Buffer.alloc(7500, 255))
    expect(fixture.bytes).toEqual(original)
  })

  it('marks each A4 section of an extended image without changing its width or height', async () => {
    const fixture = await setup(6500)
    const image = await read((await fixture.call()).stream)
    expect(await sharp(image).metadata()).toMatchObject({ width: 2100, height: 6500 })
    expect(await redPixels(image, { left: 0, top: 2970, width: 2100, height: 2970 })).toBeGreaterThan(10_000)
    expect(await redPixels(image, { left: 0, top: 5940, width: 2100, height: 560 })).toBeGreaterThan(1000)
  })

  it('uses a new stable ETag, supports conditional reads and returns the same GET/HEAD metadata', async () => {
    const fixture = await setup()
    const old = `"sha256-${createHash('sha256').update(`purchase-order-image:${fixture.asset.checksumSha256}`).digest('base64url')}"`
    const response = await fixture.call('GET', old)
    expect(response.status).toBe(200)
    const image = await read(response.stream)
    const head = await fixture.call('HEAD')
    expect(head.headers).toEqual(response.headers)
    expect(head.stream).toBeUndefined()
    const imageAgain = await read((await fixture.call()).stream)
    expect(imageAgain).toEqual(image)
    fixture.delivery.open.mockClear()
    const conditional = await fixture.call('GET', `W/${head.headers.ETag}`)
    expect(conditional.status).toBe(304)
    expect(conditional.stream).toBeUndefined()
    expect(conditional.opened).toBe(0)
  })

  it('bounds composition work for extremely narrow historical uploads', async () => {
    const fixture = await setup(16_384, 'png', 1)
    const image = await read((await fixture.call()).stream)
    expect(await sharp(image).metadata()).toMatchObject({ width: 1, height: 16_384 })
  })

  it('streams stamped content in internal redirect deployments instead of exposing the original file', async () => {
    const fixture = await setup()
    fixture.delivery.mode = 'internal_redirect'
    const response = await fixture.call()
    expect(response.headers['X-Accel-Redirect']).toBeUndefined()
    expect(await redPixels(await read(response.stream), { left: 0, top: 0, width: 2100, height: 1500 })).toBeGreaterThan(10_000)
  })

  it.each(['jpeg', 'webp'] as const)('retains the %s image format and matching response type', async format => {
    const fixture = await setup(2970, format)
    const response = await fixture.call()
    expect(response.headers['Content-Type']).toBe(`image/${format}`)
    expect(await sharp(await read(response.stream)).metadata()).toMatchObject({ format, width: 2100, height: 2970 })
  })

  it('fails closed on invalid bytes, missing storage or size limits without returning an unmarked original', async () => {
    const fixture = await setup()
    fixture.delivery.stat.mockResolvedValueOnce(null)
    await expect(fixture.callDirect()).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' })
    fixture.delivery.open.mockResolvedValueOnce({ stream: Readable.from(Buffer.from('invalid image')) })
    await expect(fixture.callDirect()).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' })
    fixture.asset.sizeBytes = 11n * 1024n * 1024n
    await expect(fixture.callDirect()).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' })
    fixture.delivery.open.mockClear()
    fixture.asset.objectKey = 'https://untrusted.example/order.png'
    await expect(fixture.callDirect()).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' })
    expect(fixture.delivery.open).not.toHaveBeenCalled()
  })
})
