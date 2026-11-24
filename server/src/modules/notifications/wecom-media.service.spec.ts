import { createHash } from 'node:crypto'

import sharp from 'sharp'

import type { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { WecomMediaService } from './wecom-media.service'

function mediaService(): WecomMediaService {
  return new WecomMediaService({} as MediaContentDeliveryService)
}

describe('WecomMediaService', () => {
  it('keeps a small PNG unchanged for app messages', async () => {
    const buffer = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#00ff00' },
    }).png().toBuffer()
    const service = mediaService()

    const result = await service.prepareAppImage({
      buffer,
      mimeType: 'image/png',
      filename: 'proof.png',
    })

    expect(result).toMatchObject({
      ok: true,
      mimeType: 'image/png',
      filename: 'proof.png',
    })
    if (result.ok) {
      expect(result.buffer.equals(buffer)).toBe(true)
    }
  })

  it('returns base64 and protocol md5 for a small robot image', async () => {
    const buffer = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#0000ff' },
    }).jpeg().toBuffer()
    const service = mediaService()

    const result = await service.prepareRobotImage(buffer)

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.base64).toBe(buffer.toString('base64'))
      expect(result.md5).toBe(createHash('md5').update(buffer).digest('hex'))
    }
  })
})
