import {
  type HealthFailureRequest,
  isTerminusHealthFailureExemption,
} from './terminus-health-failure.guard'

const terminusFailureBody = {
  status: 'error',
  info: {},
  error: { database: { status: 'down' } },
  details: { database: { status: 'down' } },
}

describe('isTerminusHealthFailureExemption', () => {
  it('accepts only a GET /api/health Terminus 503 response', () => {
    expect(
      isTerminusHealthFailureExemption(
        { method: 'GET', path: '/api/health' },
        503,
        terminusFailureBody,
      ),
    ).toBe(true)
  })

  it('uses originalUrl without its query when request.path is unavailable', () => {
    expect(
      isTerminusHealthFailureExemption(
        { method: 'GET', originalUrl: '/api/health?probe=1' },
        503,
        terminusFailureBody,
      ),
    ).toBe(true)
  })

  it('uses url without its query only after path and originalUrl are unavailable', () => {
    expect(
      isTerminusHealthFailureExemption(
        { method: 'GET', url: '/api/health?probe=1' },
        503,
        terminusFailureBody,
      ),
    ).toBe(true)
  })

  it.each([
    ['method', { method: 'POST', path: '/api/health' }, 503, terminusFailureBody],
    ['path', { method: 'GET', path: '/api/users' }, 503, terminusFailureBody],
    ['status', { method: 'GET', path: '/api/health' }, 500, terminusFailureBody],
    [
      'body status',
      { method: 'GET', path: '/api/health' },
      503,
      { ...terminusFailureBody, status: 'ok' },
    ],
    [
      'body info object',
      { method: 'GET', path: '/api/health' },
      503,
      { ...terminusFailureBody, info: [] },
    ],
    [
      'body error object',
      { method: 'GET', path: '/api/health' },
      503,
      { ...terminusFailureBody, error: null },
    ],
    [
      'body details object',
      { method: 'GET', path: '/api/health' },
      503,
      { ...terminusFailureBody, details: [] },
    ],
  ] as const)(
    'rejects the exemption when the %s condition does not match',
    (_condition, request, status, body) => {
      expect(
        isTerminusHealthFailureExemption(request, status, body),
      ).toBe(false)
    },
  )

  it('does not trust route.path as the externally visible request path', () => {
    const request = {
      method: 'GET',
      route: { path: '/health' },
    } as HealthFailureRequest & { route: { path: string } }

    expect(
      isTerminusHealthFailureExemption(request, 503, terminusFailureBody),
    ).toBe(false)
  })

  it('gives request.path priority over matching fallback URL values', () => {
    expect(
      isTerminusHealthFailureExemption(
        {
          method: 'GET',
          path: '/api/not-health',
          originalUrl: '/api/health?probe=1',
          url: '/api/health',
        },
        503,
        terminusFailureBody,
      ),
    ).toBe(false)
  })
})
