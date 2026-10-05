'use strict'

/**
 * 真实桶受控验收（`pnpm -C server media:accept:cos`，需先 `pnpm build` 且具备 `MEDIA_COS_*`）。
 *
 * 只创建/读取/搬运一个临时对象，结束时删除；只输出布尔与计数，不打印凭据、预签名 URL、桶名或对象键。
 * 退出码非零代表验收未通过；被强杀（跳过 finally）时最多留下一个 `assets/YYYY/MM/<uuid>.bin` 孤儿对象，
 * 由只读 `dry run` 的 `orphanObject` 暴露后人工清理。该脚本不进入发布归档，只在本地 checkout 内运行。
 */
require('dotenv/config')

const { createHash, randomUUID } = require('node:crypto')
const { finished } = require('node:stream/promises')
const { buffer } = require('node:stream/consumers')

const { createMediaConfiguration } = require('../dist/config/media.config')
const {
  createCosObjectClient,
  readCosCredentials,
} = require('../dist/modules/media/cos-object-client')
const { CosMediaStorage } = require('../dist/modules/media/cos-media-storage')

const failures = []

function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(name)
}

async function main() {
  const configuration = createMediaConfiguration(process.env)
  if (configuration.driver !== 'cos') {
    throw new Error('MEDIA_STORAGE_DRIVER must be cos for this acceptance run')
  }
  const client = createCosObjectClient({
    bucket: configuration.cos.bucket,
    region: configuration.cos.region,
    ...readCosCredentials(process.env),
  })
  const storage = await CosMediaStorage.create(configuration, client)

  const assetId = randomUUID()
  const objectKey = `assets/2026/10/${assetId}.bin`
  const trashKey = `trash/2026/10/${assetId}.bin`
  const bytes = Buffer.alloc(1024 * 1024 + 7)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
  const digest = createHash('sha256').update(bytes).digest('hex')

  try {
    const health = await storage.checkHealth()
    check('checkHealth', health.status === 'up', health.code)

    const staging = await storage.createStagingWrite(assetId)
    staging.stream.end(bytes)
    await finished(staging.stream)
    await storage.finalize(staging.key, objectKey)
    check('finalize 上传（含元数据）', (await storage.stat(objectKey))?.sizeBytes === BigInt(bytes.length))

    const head = await client.headObject(objectKey)
    const metadataVisible = head?.metadata['x-cos-meta-sha256'] === digest
    check('HEAD 回读：长度', head?.sizeBytes === BigInt(bytes.length))
    check('HEAD 回读：摘要元数据', metadataVisible)
    check('HEAD 回读：CRC64 可见', head?.crc64 !== null, head?.crc64 === null ? '缺失' : '存在')
    check('HEAD 回读：修改时间可解析', head?.modifiedAt instanceof Date && !Number.isNaN(head.modifiedAt.getTime()))

    check('verifyStoredObject（元数据路径）', await storage.verifyStoredObject(objectKey, {
      checksumSha256: digest,
      sizeBytes: BigInt(bytes.length),
    }))
    check('verifyStoredObject 长度不符时失败关闭', !(await storage.verifyStoredObject(objectKey, {
      checksumSha256: digest,
      sizeBytes: BigInt(bytes.length + 1),
    })))

    const full = await storage.open(objectKey)
    check('open 全文读取', (await buffer(full.stream)).equals(bytes), `contentLength=${full.contentLength}`)

    const ranged = await storage.open(objectKey, { end: 199, start: 100 })
    const rangedBytes = await buffer(ranged.stream)
    check('open Range 读取', ranged.contentLength === 100n && rangedBytes.equals(bytes.subarray(100, 200)))

    check('checksumSha256 全文摘要', await storage.checksumSha256(objectKey) === digest)

    const page = await storage.inventory({ limit: 10, namespace: 'assets', prefix: 'assets/2026/10' })
    check('inventory 列出对象', page.objects.some(object => object.key === objectKey), `count=${page.objects.length}`)

    await storage.moveToTrash(objectKey, trashKey)
    check('moveToTrash 复制后删除源', (await storage.stat(objectKey)) === null &&
      (await storage.stat(trashKey))?.sizeBytes === BigInt(bytes.length))

    await storage.restoreFromTrash(trashKey, objectKey)
    check('restoreFromTrash 复原', (await storage.stat(trashKey)) === null &&
      (await storage.stat(objectKey))?.sizeBytes === BigInt(bytes.length))

    await storage.purge(objectKey)
    check('purge 删除对象', (await storage.stat(objectKey)) === null)
  }
  finally {
    // 无论成败都清理：这两个键是本次验收唯一的残留面。
    await storage.purge(objectKey).catch(() => undefined)
    await storage.purge(trashKey).catch(() => undefined)
    const residue = await storage.inventory({ limit: 10, namespace: 'assets', prefix: 'assets/2026/10' }).catch(() => null)
    const leftover = residue === null
      ? '无法确认'
      : String(residue.objects.filter(object => object.key.includes(assetId)).length)
    console.log(`清理完成：残留对象=${leftover}`)
  }

  console.log(failures.length === 0 ? 'ACCEPTANCE PASSED' : `ACCEPTANCE FAILED: ${failures.join(', ')}`)
  process.exitCode = failures.length === 0 ? 0 : 1
}

main().catch((error) => {
  // 只输出固定事件：底层异常可能带请求 URL 与响应头。
  console.error(JSON.stringify({ kind: 'cos_acceptance', status: 'failed' }))
  if (process.env.COS_ACCEPTANCE_DEBUG === '1') console.error(String(error))
  process.exitCode = 1
})
