import {
  readServerVersion,
  resolveDeploymentEnvironment,
} from './system-runtime'

describe('resolveDeploymentEnvironment', () => {
  it.each([
    ['dev', 'dev'],
    ['test', 'test'],
    ['prod', 'prod'],
    [' DEV ', 'dev'],
  ] as const)('uses APP_ENV=%s as %s', (value, expected) => {
    expect(resolveDeploymentEnvironment({ APP_ENV: value })).toEqual({
      environment: expected,
      source: 'APP_ENV',
    })
  })

  it.each([
    ['dev', 'dev'],
    ['test', 'test'],
    ['prod', 'prod'],
  ] as const)('falls back to MEDIA_STORAGE_ENV=%s as %s', (value, expected) => {
    expect(resolveDeploymentEnvironment({ MEDIA_STORAGE_ENV: value })).toEqual({
      environment: expected,
      source: 'MEDIA_STORAGE_ENV',
    })
  })

  it('prefers APP_ENV over MEDIA_STORAGE_ENV', () => {
    expect(resolveDeploymentEnvironment({
      APP_ENV: 'test',
      MEDIA_STORAGE_ENV: 'prod',
    })).toEqual({ environment: 'test', source: 'APP_ENV' })
  })

  it('uses MEDIA_STORAGE_ENV when APP_ENV is invalid', () => {
    expect(resolveDeploymentEnvironment({
      APP_ENV: 'staging',
      MEDIA_STORAGE_ENV: 'prod',
    })).toEqual({ environment: 'prod', source: 'MEDIA_STORAGE_ENV' })
  })

  it('returns unknown when neither variable is a supported value', () => {
    expect(resolveDeploymentEnvironment({})).toEqual({
      environment: 'unknown',
      source: 'none',
    })
    expect(resolveDeploymentEnvironment({
      APP_ENV: 'staging',
      MEDIA_STORAGE_ENV: 'preview',
    })).toEqual({ environment: 'unknown', source: 'none' })
  })
})

describe('readServerVersion', () => {
  it('reads a semver version from the packaged package.json', () => {
    expect(readServerVersion()).toMatch(/^\d+\.\d+\.\d+$/u)
  })
})
