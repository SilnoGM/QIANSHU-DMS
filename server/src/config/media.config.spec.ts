import { resolve } from 'node:path'

import {
  createMediaConfiguration,
  DEFAULT_MEDIA_STORAGE_ROOT,
} from './media.config'

describe('media configuration', () => {
  it('uses the confirmed local storage lifecycle defaults', () => {
    expect(createMediaConfiguration({})).toEqual({
      driver: 'local',
      storageRoot: DEFAULT_MEDIA_STORAGE_ROOT,
      stagingTtlHours: 24,
      trashRetentionDays: 7,
    })
  })

  it('normalizes an explicit absolute root and bounded lifecycle values', () => {
    const storageRoot = resolve('/srv/qianshu-media')

    expect(
      createMediaConfiguration({
        MEDIA_STORAGE_DRIVER: 'local',
        MEDIA_STORAGE_ROOT: `  ${storageRoot}/  `,
        MEDIA_STAGING_TTL_HOURS: '48',
        MEDIA_TRASH_RETENTION_DAYS: 30,
      }),
    ).toEqual({
      driver: 'local',
      storageRoot,
      stagingTtlHours: 48,
      trashRetentionDays: 30,
    })
  })

  it.each([
    ['MEDIA_STORAGE_DRIVER', 's3', 'must be local'],
    ['MEDIA_STORAGE_ROOT', 'relative/media', 'must be an absolute non-root path'],
    ['MEDIA_STORAGE_ROOT', '/', 'must be an absolute non-root path'],
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
