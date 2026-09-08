import { HttpStatus } from '@nestjs/common'
import { ExpressAdapter } from '@nestjs/platform-express'

import { ApiException } from './api.exception'

interface PurchaseBodyRequest { readonly method: string, readonly url: string }
type Next = (error?: unknown) => void
type Middleware = (request: PurchaseBodyRequest, response: unknown, next: Next) => void

/**
 * 采购最多 1000 货件、10000 分配项，需要高于 Express 默认 100 KiB 的有限请求预算。
 * 使用已声明的 Nest Express adapter 的公开注册接口创建解析器，避免依赖其未声明的
 * 传递包。仅接收 middleware，不创建/调用子应用，防止改变 req.app、原型或 trust proxy。
 */
export function createPurchaseOrderBodyParser(): Middleware {
  let registeredParser: Middleware | undefined
  const parser = new ExpressAdapter({ use(handler: Middleware) { registeredParser = handler } })
  parser.useBodyParser('json', false, { limit: 1_048_576 })
  if (registeredParser === undefined) throw new Error('Purchase body parser registration failed')
  const middleware: Middleware = registeredParser
  return (request, response, next) => {
    if (request.method !== 'POST' || !/^\/api\/purchase-orders\/?$/iu.test(request.url.split('?')[0])) {
      next()
      return
    }
    middleware(request, response, (error) => {
      if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
        next(new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', '采购创建请求体不得超过 1 MiB'))
      }
      else next(error)
    })
  }
}
