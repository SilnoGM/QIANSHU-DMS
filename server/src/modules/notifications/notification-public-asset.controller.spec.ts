import { ApiException } from '../../infrastructure/http/api.exception'
import { NotificationPublicAssetController } from './notification-public-asset.controller'
import type { NotificationAssetUrlService } from './notification-asset-url.service'
import type { NotificationContentMediaService } from './notification-content-media.service'

const ASSET_ID = '00000000-0000-4000-8000-000000000444'

function controller(options: {
  readonly assetId: string | null
  readonly content?: jest.Mock
}): { controller: NotificationPublicAssetController, media: NotificationContentMediaService } {
  const assets = {
    verifyNewsImageToken: jest.fn().mockReturnValue(options.assetId),
  } as unknown as NotificationAssetUrlService
  const media = {
    content: options.content ?? jest.fn(),
  } as unknown as NotificationContentMediaService
  return { controller: new NotificationPublicAssetController(assets, media), media }
}

function response(): { status: jest.Mock, setHeader: jest.Mock } {
  return { status: jest.fn(), setHeader: jest.fn() }
}

async function expectApiException(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status, code })
}

describe('NotificationPublicAssetController', () => {
  it('rejects an invalid or expired token without touching media', async () => {
    const content = jest.fn()
    const { controller: instance, media } = controller({ assetId: null, content })

    await expectApiException(instance.get('bad-token', response()), 404, 'NOTIFICATION_PUBLIC_ASSET_NOT_FOUND')
    expect(media.content).not.toHaveBeenCalled()
  })

  it('streams the referenced image with its contract headers', async () => {
    const content = jest.fn().mockResolvedValue({
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Content-Length': '12' },
    })
    const { controller: instance } = controller({ assetId: ASSET_ID, content })
    const res = response()

    const result = await instance.get('valid-token', res)

    expect(result).toBeUndefined()
    expect(content).toHaveBeenCalledWith(ASSET_ID, undefined, 'GET')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '12')
  })

  it('masks media lookup failures but preserves storage errors', async () => {
    const notFound = controller({
      assetId: ASSET_ID,
      content: jest.fn().mockRejectedValue(new ApiException(404, 'NOTIFICATION_CONTENT_MEDIA_NOT_FOUND', '内容图片不存在')),
    })
    await expectApiException(notFound.controller.get('valid-token', response()), 404, 'NOTIFICATION_PUBLIC_ASSET_NOT_FOUND')

    const unavailable = controller({
      assetId: ASSET_ID,
      content: jest.fn().mockRejectedValue(new ApiException(503, 'MEDIA_STORAGE_UNAVAILABLE', '媒体存储不可用')),
    })
    await expectApiException(unavailable.controller.get('valid-token', response()), 503, 'MEDIA_STORAGE_UNAVAILABLE')
  })
})
