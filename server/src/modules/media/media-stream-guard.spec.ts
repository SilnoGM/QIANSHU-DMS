import { createHash } from 'node:crypto'
import { PassThrough, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { MediaValidationError } from './media-validation'
import { createMediaStreamGuard } from './media-stream-guard'

describe('createMediaStreamGuard', () => {
  it('passes chunks through while producing an exact byte count and SHA-256', async () => {
    const chunks = [Buffer.from('trusted-'), Buffer.from('media-content')]
    const guard = createMediaStreamGuard(64n)
    const destination = new PassThrough()
    const output: Buffer[] = []
    destination.on('data', chunk => output.push(Buffer.from(chunk)))

    await pipeline(Readable.from(chunks), guard.stream, destination)

    await expect(guard.completion).resolves.toEqual({
      checksumSha256: createHash('sha256').update(Buffer.concat(chunks)).digest('hex'),
      sizeBytes: BigInt(Buffer.concat(chunks).length),
    })
    expect(Buffer.concat(output)).toEqual(Buffer.concat(chunks))
  })

  it('accepts the exact maximum and rejects the first excess byte with a fixed error', async () => {
    const exact = createMediaStreamGuard(4n)
    await pipeline(Readable.from([Buffer.from('1234')]), exact.stream, new PassThrough())
    await expect(exact.completion).resolves.toMatchObject({ sizeBytes: 4n })

    const exceeded = createMediaStreamGuard(4n)
    await expect(
      pipeline(
        Readable.from([Buffer.from('12'), Buffer.from('345')]),
        exceeded.stream,
        new PassThrough(),
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_CONTENT_TOO_LARGE' })
    await expect(exceeded.completion).rejects.toMatchObject({
      code: 'MEDIA_CONTENT_TOO_LARGE',
      message: 'Media content exceeds the allowed size',
    })
  })

  it.each([-1n, 0n])('rejects an invalid maximum before consuming input: %s', (maximumBytes) => {
    expect(() => createMediaStreamGuard(maximumBytes)).toThrow(MediaValidationError)
    expect(() => createMediaStreamGuard(maximumBytes)).toThrow(
      'Media validation configuration is invalid',
    )
  })

  it('settles completion with the same fixed failure when the source aborts', async () => {
    const sensitiveCanary = '/private/upload/customer-file.mp4'
    const source = new Readable({
      read() {
        this.destroy(new Error(sensitiveCanary))
      },
    })
    const guard = createMediaStreamGuard(64n)

    await expect(pipeline(source, guard.stream, new PassThrough())).rejects.toThrow(
      sensitiveCanary,
    )
    await expect(guard.completion).rejects.toMatchObject({
      code: 'MEDIA_CONTENT_STREAM_FAILED',
      message: 'Media content stream failed',
    })
  })
})
