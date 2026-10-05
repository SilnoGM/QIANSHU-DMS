import { resolve } from 'node:path'

import {
  createMediaConfiguration,
  DEFAULT_MEDIA_STORAGE_ROOT,
} from './media.config'

/**
 * 占位凭据在运行时拼接：测试需要非空值走通 cos 分支，但源码里不允许出现任何形似真实密钥的字面量。
 */
function placeholderCredential(label: string): string {
  return ['placeholder', label, '0123456789abcdef'].join('-')
}

const COS_SECRET_ID = placeholderCredential('id')
const COS_SECRET_KEY = placeholderCredential('key')

const COS_ENVIRONMENT: Record<string, unknown> = Object.freeze({
  MEDIA_COS_BUCKET: 'dms-qs-media-1396967080',
  MEDIA_COS_REGION: 'ap-beijing',
  MEDIA_COS_SECRET_ID: COS_SECRET_ID,
  MEDIA_COS_SECRET_KEY: COS_SECRET_KEY,
  MEDIA_STORAGE_DRIVER: 'cos',
})

function cosEnvironment(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...COS_ENVIRONMENT, ...overrides }
}

function mediaConfigurationError(
  environment: Record<string, unknown>,
): Error {
  try {
    createMediaConfiguration(environment)
  }
  catch (error) {
    return error as Error
  }
  throw new Error('Expected media configuration validation to fail')
}

describe('media configuration', () => {
  it('uses the confirmed local storage lifecycle defaults', () => {
    expect(createMediaConfiguration({})).toEqual({
      contentDeliveryMode: 'application',
      driver: 'local',
      ffprobePath: '/usr/bin/ffprobe',
      qpdfPath: '/usr/bin/qpdf',
      storageRoot: DEFAULT_MEDIA_STORAGE_ROOT,
      stagingTtlHours: 24,
      trashRetentionDays: 7,
    })
  })

  it('normalizes an explicit absolute root and bounded lifecycle values', () => {
    const storageRoot = resolve('/srv/qianshu-media')

    expect(
      createMediaConfiguration({
        MEDIA_CONTENT_DELIVERY_MODE: 'internal_redirect',
        MEDIA_STORAGE_DRIVER: 'local',
        MEDIA_FFPROBE_PATH: '  /opt/media/bin/ffprobe  ',
        MEDIA_QPDF_PATH: '/opt/media/bin/qpdf',
        MEDIA_STORAGE_ROOT: `  ${storageRoot}/  `,
        MEDIA_STAGING_TTL_HOURS: '48',
        MEDIA_TRASH_RETENTION_DAYS: 30,
      }),
    ).toEqual({
      contentDeliveryMode: 'internal_redirect',
      driver: 'local',
      ffprobePath: '/opt/media/bin/ffprobe',
      qpdfPath: '/opt/media/bin/qpdf',
      storageRoot,
      stagingTtlHours: 48,
      trashRetentionDays: 30,
    })
  })

  it('defaults production to internal redirect while allowing an explicit application override', () => {
    expect(createMediaConfiguration({ NODE_ENV: 'production' }))
      .toMatchObject({ contentDeliveryMode: 'internal_redirect' })
    expect(createMediaConfiguration({
      NODE_ENV: 'production',
      MEDIA_CONTENT_DELIVERY_MODE: 'application',
    })).toMatchObject({ contentDeliveryMode: 'application' })
  })

  it('builds a cos target while keeping credentials out of the configuration object', () => {
    const configuration = createMediaConfiguration(cosEnvironment())

    expect(configuration).toEqual({
      contentDeliveryMode: 'application',
      cos: { bucket: 'dms-qs-media-1396967080', region: 'ap-beijing' },
      driver: 'cos',
      ffprobePath: '/usr/bin/ffprobe',
      qpdfPath: '/usr/bin/qpdf',
      storageRoot: DEFAULT_MEDIA_STORAGE_ROOT,
      stagingTtlHours: 24,
      trashRetentionDays: 7,
    })
    const serialized = JSON.stringify(configuration)
    expect(serialized).not.toContain(COS_SECRET_ID)
    expect(serialized).not.toContain(COS_SECRET_KEY)
    expect(Object.isFrozen(configuration)).toBe(true)
  })

  it('defaults the cos driver to application delivery even in production', () => {
    expect(
      createMediaConfiguration(cosEnvironment({ NODE_ENV: 'production' })),
    ).toMatchObject({ contentDeliveryMode: 'application', driver: 'cos' })
  })

  it('rejects internal redirect delivery together with the cos driver', () => {
    expect(
      mediaConfigurationError(cosEnvironment({
        MEDIA_CONTENT_DELIVERY_MODE: 'internal_redirect',
      })).message,
    ).toBe(
      'Environment validation failed: MEDIA_CONTENT_DELIVERY_MODE must be application when MEDIA_STORAGE_DRIVER is cos',
    )
  })

  it.each([
    ['MEDIA_COS_REGION', undefined, 'must be a COS region identifier'],
    ['MEDIA_COS_REGION', 'ap beijing', 'must be a COS region identifier'],
    ['MEDIA_COS_REGION', 'AP-BEIJING', 'must be a COS region identifier'],
    ['MEDIA_COS_BUCKET', undefined, 'must be a COS bucket name with appid suffix'],
    ['MEDIA_COS_BUCKET', 'dms-qs-media', 'must be a COS bucket name with appid suffix'],
    ['MEDIA_COS_BUCKET', 'Dms-Qs-Media-1396967080', 'must be a COS bucket name with appid suffix'],
    ['MEDIA_COS_SECRET_ID', undefined, 'must be a COS credential'],
    ['MEDIA_COS_SECRET_ID', 'short', 'must be a COS credential'],
    ['MEDIA_COS_SECRET_KEY', undefined, 'must be a COS credential'],
    ['MEDIA_COS_SECRET_KEY', 'has whitespace inside', 'must be a COS credential'],
  ])(
    'rejects %s=%s while the cos driver is active without echoing any credential',
    (key, value, constraint) => {
      const environment = cosEnvironment()
      if (value === undefined) delete environment[key]
      else environment[key] = value

      const error = mediaConfigurationError(environment)
      expect(error.message).toBe(
        `Environment validation failed: ${key} ${constraint}`,
      )
      if (typeof value === 'string') {
        expect(error.message).not.toContain(value)
      }
      expect(error.message).not.toContain(COS_SECRET_ID)
      expect(error.message).not.toContain(COS_SECRET_KEY)
    },
  )

  it.each([
    ['MEDIA_CONTENT_DELIVERY_MODE', 'public', 'must be one of application, internal_redirect'],
    ['MEDIA_STORAGE_DRIVER', 's3', 'must be one of local, cos'],
    ['MEDIA_STORAGE_ROOT', 'relative/media', 'must be an absolute non-root path'],
    ['MEDIA_STORAGE_ROOT', '/', 'must be an absolute non-root path'],
    ['MEDIA_FFPROBE_PATH', 'ffprobe', 'must be an absolute executable path'],
    ['MEDIA_QPDF_PATH', '/', 'must be an absolute executable path'],
    ['MEDIA_STAGING_TTL_HOURS', 0, 'must be an integer between 1 and 168'],
    ['MEDIA_STAGING_TTL_HOURS', 169, 'must be an integer between 1 and 168'],
    ['MEDIA_TRASH_RETENTION_DAYS', 6, 'must be an integer between 7 and 3650'],
    ['MEDIA_TRASH_RETENTION_DAYS', 3651, 'must be an integer between 7 and 3650'],
  ])('rejects unsafe %s without echoing its value', (key, value, constraint) => {
    try {
      createMediaConfiguration({ [key]: value })
      throw new Error('Expected media configuration validation to fail')
    }
    catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(
        `Environment validation failed: ${key} ${constraint}`,
      )
      if (typeof value === 'string') {
        expect((error as Error).message).not.toContain(value)
      }
    }
  })
})
