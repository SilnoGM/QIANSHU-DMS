import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { Controller, Get, HttpException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { firstValueFrom, of, throwError, type Observable } from 'rxjs'

import { RequestPerformanceInterceptor } from './request-performance.interceptor'
import { RequestPerformanceMetrics } from './request-performance-metrics'

@Controller('products')
class ProductsController {
  @Get(':id')
  detail(): string {
    return 'ok'
  }
}

@Controller('health')
class HealthController {
  @Get()
  check(): string {
    return 'ok'
  }
}

@Controller('system/status')
class SystemStatusController {
  @Get()
  get(): string {
    return 'ok'
  }
}

@Controller('auth')
class AuthController {
  @Get('me')
  me(): string {
    return 'ok'
  }
}

@Controller('notifications/me/inbox')
class NotificationInboxController {
  @Get('unread-count')
  unreadCount(): string {
    return 'ok'
  }
}

@Controller('proxy-nodes')
class ProxyNodesController {
  @Get('mine/expiry-summary')
  expirySummary(): string {
    return 'ok'
  }

  @Get('expiry-summary')
  summary(): string {
    return 'ok'
  }
}

@Controller('profile')
class ProfileController {
  @Get()
  get(): string {
    return 'ok'
  }
}

function createContext(
  controller: new () => unknown,
  handler: () => unknown,
  statusCode = 200,
): ExecutionContext {
  return {
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext
}

function createCallHandler(observable: Observable<unknown>): CallHandler {
  return { handle: () => observable }
}

describe('RequestPerformanceInterceptor', () => {
  it('records method, route template, status and duration', async () => {
    const metrics = new RequestPerformanceMetrics()
    const interceptor = new RequestPerformanceInterceptor(metrics, new Reflector())
    const context = createContext(ProductsController, ProductsController.prototype.detail)

    await firstValueFrom(interceptor.intercept(context, createCallHandler(of('ok'))))

    expect(metrics.snapshot()).toMatchObject({
      totalRequests: 1,
      windowRequests: 1,
      serverErrors: 0,
      clientErrors: 0,
    })
    expect(metrics.snapshot().slowest[0]).toMatchObject({
      operation: 'GET /products/:id',
      statusCode: 200,
    })
  })

  it('records the exception status instead of defaulting every failure to 500', async () => {
    const metrics = new RequestPerformanceMetrics()
    const interceptor = new RequestPerformanceInterceptor(metrics, new Reflector())
    const context = createContext(ProductsController, ProductsController.prototype.detail)
    const handler = createCallHandler(
      throwError(() => new HttpException('unprocessable', 422)),
    )

    await expect(firstValueFrom(interceptor.intercept(context, handler)))
      .rejects
      .toThrow('unprocessable')

    expect(metrics.snapshot()).toMatchObject({
      windowRequests: 1,
      serverErrors: 0,
      clientErrors: 1,
    })
  })

  it('does not count health probes or the status page polling itself', async () => {
    const metrics = new RequestPerformanceMetrics()
    const interceptor = new RequestPerformanceInterceptor(metrics, new Reflector())

    await firstValueFrom(interceptor.intercept(
      createContext(HealthController, HealthController.prototype.check),
      createCallHandler(of('ok')),
    ))
    await firstValueFrom(interceptor.intercept(
      createContext(SystemStatusController, SystemStatusController.prototype.get),
      createCallHandler(of('ok')),
    ))

    expect(metrics.snapshot()).toMatchObject({
      totalRequests: 0,
      windowRequests: 0,
    })
  })

  it('does not count session, inbox or proxy expiry polling as business requests', async () => {
    const metrics = new RequestPerformanceMetrics()
    const interceptor = new RequestPerformanceInterceptor(metrics, new Reflector())

    await firstValueFrom(interceptor.intercept(
      createContext(AuthController, AuthController.prototype.me),
      createCallHandler(of('ok')),
    ))
    await firstValueFrom(interceptor.intercept(
      createContext(NotificationInboxController, NotificationInboxController.prototype.unreadCount),
      createCallHandler(of('ok')),
    ))
    await firstValueFrom(interceptor.intercept(
      createContext(ProxyNodesController, ProxyNodesController.prototype.expirySummary),
      createCallHandler(of('ok')),
    ))
    await firstValueFrom(interceptor.intercept(
      createContext(ProxyNodesController, ProxyNodesController.prototype.summary),
      createCallHandler(of('ok')),
    ))
    await firstValueFrom(interceptor.intercept(
      createContext(ProfileController, ProfileController.prototype.get),
      createCallHandler(of('ok')),
    ))

    expect(metrics.snapshot()).toMatchObject({
      totalRequests: 0,
      windowRequests: 0,
    })
  })
})
