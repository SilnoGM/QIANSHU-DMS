import { Readable } from 'node:stream'

import type { ProductMediaKind } from '../../../generated/prisma/enums'
import {
  ProductMediaMultipartParser,
  type ProductMediaMultipartRequest,
} from './product-media-multipart.parser'

const BOUNDARY = 'qianshu-product-media-boundary'

interface MultipartPart {
  readonly name: string
  readonly value: string
  readonly filename?: string
  readonly mimeType?: string
}

function multipartBody(parts: readonly MultipartPart[]): Buffer {
  const chunks: string[] = []
  for (const part of parts) {
    chunks.push(`--${BOUNDARY}\r\n`)
    if (part.filename === undefined) {
      chunks.push(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`)
    }
    else {
      chunks.push(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`,
        `Content-Type: ${part.mimeType ?? 'application/octet-stream'}\r\n\r\n`,
      )
    }
    chunks.push(part.value, '\r\n')
  }
  chunks.push(`--${BOUNDARY}--\r\n`)
  return Buffer.from(chunks.join(''))
}

function requestFor(parts: readonly MultipartPart[]): ProductMediaMultipartRequest {
  const body = multipartBody(parts)
  return Object.assign(Readable.from([
    body.subarray(0, Math.floor(body.length / 2)),
    body.subarray(Math.floor(body.length / 2)),
  ]), {
    headers: {
      'content-length': String(body.length),
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
    },
  })
}

const validParts = (fileValue = 'image-content'): MultipartPart[] => [{
  name: 'kind',
  value: 'IMAGE',
}, {
  name: 'expectedVersion',
  value: '2',
}, {
  name: 'file',
  filename: 'front.jpg',
  mimeType: 'image/jpeg',
  value: fileValue,
}]

describe('ProductMediaMultipartParser', () => {
  it('streams one exact file and normalizes trusted fields without buffering it in the DTO', async () => {
    const parser = new ProductMediaMultipartParser()
    const handler = jest.fn(async (input: {
      readonly declaredMimeType: string | null
      readonly expectedVersion: number
      readonly kind: ProductMediaKind
      readonly originalFilename: string
      readonly stream: Readable
    }) => {
      const chunks: Buffer[] = []
      for await (const chunk of input.stream) chunks.push(Buffer.from(chunk))
      return {
        bytes: Buffer.concat(chunks).toString(),
        fields: {
          declaredMimeType: input.declaredMimeType,
          expectedVersion: input.expectedVersion,
          kind: input.kind,
          originalFilename: input.originalFilename,
        },
      }
    })

    await expect(parser.parse(requestFor(validParts()), handler)).resolves.toEqual({
      bytes: 'image-content',
      fields: {
        declaredMimeType: 'image/jpeg',
        expectedVersion: 2,
        kind: 'IMAGE',
        originalFilename: 'front.jpg',
      },
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('decodes browser multipart filenames as UTF-8 before the media asset safety boundary', async () => {
    const filename = '4月2日-微耕機01.mp4'
    const parts = validParts()
    parts[2] = {
      ...parts[2],
      filename,
      mimeType: 'video/mp4',
    }

    await expect(new ProductMediaMultipartParser().parse(
      requestFor(parts),
      async (input) => {
        for await (const chunk of input.stream) void chunk
        return input.originalFilename
      },
    )).resolves.toBe(filename)
  })

  it.each([
    ['file before fields', [validParts()[2], validParts()[0], validParts()[1]]],
    ['unknown field', [...validParts(), { name: 'extra', value: 'secret' }]],
    ['duplicate field', [validParts()[0], validParts()[0], validParts()[1], validParts()[2]]],
    ['duplicate file', [...validParts(), validParts()[2]]],
    ['invalid version', [validParts()[0], { name: 'expectedVersion', value: '0' }, validParts()[2]]],
  ] as const)('rejects %s with a stable multipart error', async (_case, parts) => {
    const handler = jest.fn(async ({ stream }: { stream: Readable }) => {
      for await (const chunk of stream) void chunk
      return 'must-not-commit'
    })
    await expect(new ProductMediaMultipartParser().parse(
      requestFor(parts),
      handler,
    )).rejects.toMatchObject({
      status: 400,
      code: 'MEDIA_MULTIPART_INVALID',
    })
  })

  it('rejects Product Document with the stable unsupported media type contract', async () => {
    await expect(new ProductMediaMultipartParser().parse(requestFor([
      { name: 'kind', value: 'DOCUMENT' },
      validParts()[1],
      validParts()[2],
    ]), async ({ stream }) => {
      for await (const chunk of stream) void chunk
    })).rejects.toMatchObject({
      status: 415,
      code: 'MEDIA_TYPE_UNSUPPORTED',
    })
  })

  it('does not let a trailing invalid field end the domain stream and commit', async () => {
    let committed = false
    const handler = async ({ stream }: { stream: Readable }): Promise<void> => {
      for await (const chunk of stream) void chunk
      committed = true
    }
    await expect(new ProductMediaMultipartParser().parse(
      requestFor([...validParts(), { name: 'unknown', value: 'value' }]),
      handler,
    )).rejects.toMatchObject({ code: 'MEDIA_MULTIPART_INVALID' })
    expect(committed).toBe(false)
  })

  it('maps parser file limits to 413 before calling a successful domain commit', async () => {
    let committed = false
    const parser = new ProductMediaMultipartParser({ maximumFileBytes: 3 })
    await expect(parser.parse(requestFor(validParts('four')), async ({ stream }: {
      readonly stream: Readable
    }) => {
      for await (const chunk of stream) void chunk
      committed = true
    })).rejects.toMatchObject({
      status: 413,
      code: 'MEDIA_FILE_TOO_LARGE',
    })
    expect(committed).toBe(false)
  })
})
