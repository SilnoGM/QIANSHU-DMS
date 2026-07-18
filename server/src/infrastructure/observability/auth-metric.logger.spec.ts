import {
  AuthMetricLogger,
  type AuthMetricOutput,
} from './auth-metric.logger'

function createFixture() {
  const log = jest.fn<void, [string]>()
  const output: AuthMetricOutput = { log }

  return { logger: new AuthMetricLogger(output), log }
}

function metricAt(log: jest.Mock<void, [string]>, index: number): unknown {
  return JSON.parse(String(log.mock.calls[index]?.[0])) as unknown
}

describe('AuthMetricLogger', () => {
  it('writes login, Session, password and HTTP counters as one safe JSON line', () => {
    const { logger, log } = createFixture()

    logger.recordLogin('success')
    logger.recordSession('created')
    logger.recordSession('valid')
    logger.recordSession('expired')
    logger.recordSessionRevoked(3)
    logger.recordPassword('reset', 'failure')
    logger.recordHttpError(503)

    expect(log).toHaveBeenCalledTimes(7)
    expect(metricAt(log, 0)).toEqual({
      kind: 'metric',
      metric: 'auth_login_total',
      value: 1,
      labels: { result: 'success' },
    })
    expect(metricAt(log, 1)).toEqual({
      kind: 'metric',
      metric: 'auth_session_total',
      value: 1,
      labels: { event: 'created' },
    })
    expect(metricAt(log, 2)).toEqual({
      kind: 'metric',
      metric: 'auth_session_total',
      value: 1,
      labels: { event: 'valid' },
    })
    expect(metricAt(log, 3)).toEqual({
      kind: 'metric',
      metric: 'auth_session_total',
      value: 1,
      labels: { event: 'expired' },
    })
    expect(metricAt(log, 4)).toEqual({
      kind: 'metric',
      metric: 'auth_session_total',
      value: 3,
      labels: { event: 'revoked' },
    })
    expect(metricAt(log, 5)).toEqual({
      kind: 'metric',
      metric: 'auth_password_operation_total',
      value: 1,
      labels: { operation: 'reset', result: 'failure' },
    })
    expect(metricAt(log, 6)).toEqual({
      kind: 'metric',
      metric: 'auth_http_error_total',
      value: 1,
      labels: { status: '503' },
    })
  })

  it('records Argon2 capacity, rejection and latency without credential data', () => {
    const { logger, log } = createFixture()

    logger.recordArgon2Capacity(2, 4)
    logger.recordArgon2Rejected('verify')
    logger.recordArgon2Latency('hash', 'success', 12.34567)

    expect(log).toHaveBeenCalledTimes(4)
    expect(metricAt(log, 0)).toEqual({
      kind: 'metric',
      metric: 'auth_argon2_active',
      value: 2,
      labels: {},
    })
    expect(metricAt(log, 1)).toEqual({
      kind: 'metric',
      metric: 'auth_argon2_queue',
      value: 4,
      labels: {},
    })
    expect(metricAt(log, 2)).toEqual({
      kind: 'metric',
      metric: 'auth_argon2_rejected_total',
      value: 1,
      labels: { operation: 'verify' },
    })
    expect(metricAt(log, 3)).toEqual({
      kind: 'metric',
      metric: 'auth_argon2_latency_ms',
      value: 12.346,
      labels: { operation: 'hash', result: 'success' },
    })
  })

  it('drops invalid runtime labels and values instead of emitting high-cardinality data', () => {
    const { logger, log } = createFixture()
    const unsafe = logger as unknown as {
      recordLogin(result: string): void
      recordHttpError(status: number): void
      recordPassword(operation: string, result: string): void
      recordSession(event: string): void
      recordSessionRevoked(count: number): void
    }

    unsafe.recordLogin('username:operator')
    unsafe.recordSession('session-id-canary')
    unsafe.recordPassword('password-canary', 'raw-error-canary')
    unsafe.recordHttpError(500)
    unsafe.recordSessionRevoked(Number.NaN)
    unsafe.recordSessionRevoked(-1)

    expect(log).not.toHaveBeenCalled()
  })

  it('never lets a logging failure break an authentication operation', () => {
    const output: AuthMetricOutput = {
      log() {
        throw new Error('metric transport failed with secret canary')
      },
    }
    const logger = new AuthMetricLogger(output)

    expect(() => logger.recordLogin('failure')).not.toThrow()
    expect(() => logger.recordArgon2Capacity(1, 0)).not.toThrow()
  })
})
