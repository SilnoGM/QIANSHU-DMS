import { mkdtemp, open, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'

import { MediaContentValidator } from './media-content-validator'
import { MediaValidationError } from './media-validation'

const VALIDATOR_CONFIGURATION = {
  ffprobePath: '/usr/bin/ffprobe',
  qpdfPath: '/usr/bin/qpdf',
}

async function detectImageFileType(sourcePath: string) {
  const handle = await open(sourcePath, 'r')
  try {
    const signature = Buffer.alloc(16)
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0)
    const bytes = signature.subarray(0, bytesRead)
    if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return { ext: 'jpg', mime: 'image/jpeg' }
    }
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { ext: 'png', mime: 'image/png' }
    }
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
      return { ext: 'webp', mime: 'image/webp' }
    }
    return undefined
  }
  finally {
    await handle.close()
  }
}

function createImageValidator(): MediaContentValidator {
  return new MediaContentValidator(VALIDATOR_CONFIGURATION, {
    // Jest 29 无法解析 ESM-only file-type@21；此注入只复现 magic hint，
    // 最终 Node 24 smoke 仍执行生产默认 detector。
    detectFileType: detectImageFileType,
  })
}

describe('MediaContentValidator IMAGE', () => {
  let sandbox: string
  let validator: MediaContentValidator

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'qianshu-media-image-test-'))
    validator = createImageValidator()
  })

  afterEach(async () => {
    await rm(sandbox, { force: true, recursive: true })
  })

  it.each([
    ['jpeg', 'photo.jpeg', 'image/jpeg', '.jpg'],
    ['png', 'photo.png', 'image/png', '.png'],
    ['webp', 'photo.webp', 'image/webp', '.webp'],
  ] as const)(
    'fully validates %s and returns trusted canonical metadata',
    async (format, originalFilename, declaredMimeType, canonicalExtension) => {
      const sourcePath = join(sandbox, originalFilename)
      const image = sharp({
        create: {
          background: { alpha: 1, b: 30, g: 20, r: 10 },
          channels: 4,
          height: 3,
          width: 5,
        },
      })
      await image[format]().toFile(sourcePath)
      const sourceStat = await stat(sourcePath)

      await expect(
        validator.validate({
          declaredMimeType,
          expectedMediaType: 'IMAGE',
          originalFilename,
          sourcePath,
        }),
      ).resolves.toEqual({
        canonicalExtension,
        height: 3,
        mediaType: 'IMAGE',
        mimeType: declaredMimeType,
        sizeBytes: BigInt(sourceStat.size),
        width: 5,
      })
    },
  )

  it('reports browser-oriented dimensions without rewriting the image', async () => {
    const sourcePath = join(sandbox, 'oriented.jpg')
    await sharp({
      create: {
        background: { b: 3, g: 2, r: 1 },
        channels: 3,
        height: 3,
        width: 2,
      },
    }).jpeg().withMetadata({ orientation: 6 }).toFile(sourcePath)

    await expect(
      validator.validate({
        declaredMimeType: 'image/jpeg',
        expectedMediaType: 'IMAGE',
        originalFilename: 'oriented.jpeg',
        sourcePath,
      }),
    ).resolves.toMatchObject({ height: 2, width: 3 })
  })

  it.each([
    ['photo.png', 'image/jpeg'],
    ['photo.jpg', 'image/png'],
    ['photo.svg', 'image/svg+xml'],
  ])('rejects extension/MIME/magic conflicts: %s %s', async (originalFilename, declaredMimeType) => {
    const sourcePath = join(sandbox, 'actual.png')
    await sharp({
      create: {
        background: 'red',
        channels: 3,
        height: 1,
        width: 1,
      },
    }).png().toFile(sourcePath)

    await expect(
      validator.validate({
        declaredMimeType,
        expectedMediaType: 'IMAGE',
        originalFilename,
        sourcePath,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_CONTENT_TYPE_MISMATCH' })
  })

  it('rejects SVG and renamed executable content before image decoding', async () => {
    const svgPath = join(sandbox, 'vector.svg')
    const executablePath = join(sandbox, 'renamed.jpg')
    await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
    await writeFile(executablePath, Buffer.from('MZ\u0000\u0000unsafe-executable'))

    for (const [sourcePath, originalFilename, declaredMimeType] of [
      [svgPath, 'vector.svg', 'image/svg+xml'],
      [executablePath, 'renamed.jpg', 'image/jpeg'],
    ]) {
      await expect(
        validator.validate({
          declaredMimeType,
          expectedMediaType: 'IMAGE',
          originalFilename,
          sourcePath,
        }),
      ).rejects.toBeInstanceOf(MediaValidationError)
    }
  })

  it('rejects a JPEG whose header remains recognizable but full decode is truncated', async () => {
    const sourcePath = join(sandbox, 'truncated.jpg')
    await sharp({
      create: {
        background: 'blue',
        channels: 3,
        height: 64,
        width: 64,
      },
    }).jpeg({ quality: 90 }).toFile(sourcePath)
    const original = await readFile(sourcePath)
    await truncate(sourcePath, Math.max(32, Math.floor(original.length / 2)))

    await expect(
      validator.validate({
        declaredMimeType: 'image/jpeg',
        expectedMediaType: 'IMAGE',
        originalFilename: 'truncated.jpg',
        sourcePath,
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_CONTENT_INVALID',
      message: 'Media content is invalid',
    })
  })

  it('rejects the image byte limit before invoking a decoder', async () => {
    const sourcePath = join(sandbox, 'oversized.png')
    await writeFile(sourcePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    await truncate(sourcePath, 10 * 1024 * 1024 + 1)

    await expect(
      validator.validate({
        declaredMimeType: 'image/png',
        expectedMediaType: 'IMAGE',
        originalFilename: 'oversized.png',
        sourcePath,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_CONTENT_TOO_LARGE' })
  })

  it('does not include a source path or original filename in validation errors', async () => {
    const sourcePath = join(sandbox, 'customer-secret-name.jpg')
    await writeFile(sourcePath, 'not-an-image')

    try {
      await validator.validate({
        declaredMimeType: 'image/jpeg',
        expectedMediaType: 'IMAGE',
        originalFilename: 'customer-secret-name.jpg',
        sourcePath,
      })
      throw new Error('Expected image validation to fail')
    }
    catch (error) {
      expect(error).toBeInstanceOf(MediaValidationError)
      expect(String(error)).not.toContain(sourcePath)
      expect(String(error)).not.toContain('customer-secret-name')
    }
  })
})
