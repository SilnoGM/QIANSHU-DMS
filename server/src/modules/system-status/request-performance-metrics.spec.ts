import {
  PERFORMANCE_WINDOW_MS,
  RequestPerformanceMetrics,
} from './request-performance-metrics'

describe('RequestPerformanceMetrics', () => {
  it('counts request volume, server errors and client errors inside the window', () => {
    const metrics = new RequestPerformanceMetrics()
    const now = 1_700_000_000_000
    metrics.record({ at: now - 1_000, durationMs: 10, operation: 'GET /products', statusCode: 200 })
    metrics.record({ at: now - 2_000, durationMs: 30, operation: 'GET /products', statusCode: 500 })
    metrics.record({ at: now - 3_000, durationMs: 20, operation: 'POST /orders', statusCode: 422 })

    expect(metrics.snapshot(now)).toMatchObject({
      totalRequests: 3,
      windowRequests: 3,
      serverErrors: 1,
      clientErrors: 1,
      errorRatePercent: 33.33,
      averageMs: 20,
      p95Ms: 30,
    })
  })

  it('prunes samples older than the window while keeping the lifetime total', () => {
    const metrics = new RequestPerformanceMetrics()
    const now = 1_700_000_000_000
    metrics.record({
      at: now - PERFORMANCE_WINDOW_MS - 1,
      durationMs: 10,
      operation: 'GET /old',
      statusCode: 200,
    })
    metrics.record({ at: now, durationMs: 20, operation: 'GET /new', statusCode: 200 })

    expect(metrics.snapshot(now)).toMatchObject({
      totalRequests: 2,
      windowRequests: 1,
      errorRatePercent: 0,
    })
  })

  it('returns null statistics for an empty window and ignores invalid records', () => {
    const metrics = new RequestPerformanceMetrics()
    metrics.record({ at: 1_000, durationMs: Number.NaN, operation: 'GET /bad', statusCode: 200 })
    metrics.record({ at: 1_000, durationMs: 10, operation: ' ', statusCode: 200 })

    expect(metrics.snapshot(1_000)).toMatchObject({
      totalRequests: 0,
      windowRequests: 0,
      serverErrors: 0,
      clientErrors: 0,
      errorRatePercent: null,
      averageMs: null,
      p95Ms: null,
      slowest: [],
    })
  })

  it('keeps the slowest operations without exposing raw URLs', () => {
    const metrics = new RequestPerformanceMetrics()
    const now = 1_700_000_000_000
    for (let index = 0; index < 10; index += 1) {
      metrics.record({
        at: now - index,
        durationMs: index * 10,
        operation: `GET /products/${index}`,
        statusCode: 200,
      })
    }

    const snapshot = metrics.snapshot(now)
    expect(snapshot.slowest).toHaveLength(5)
    expect(snapshot.slowest[0]).toMatchObject({
      durationMs: 90,
      operation: 'GET /products/9',
      statusCode: 200,
    })
  })

  it('resets all counters', () => {
    const metrics = new RequestPerformanceMetrics()
    metrics.record({ at: 1_000, durationMs: 10, operation: 'GET /x', statusCode: 200 })
    metrics.reset()
    expect(metrics.snapshot(1_000)).toMatchObject({
      totalRequests: 0,
      windowRequests: 0,
    })
  })
})
