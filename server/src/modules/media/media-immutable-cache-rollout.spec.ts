import { IMMUTABLE_MEDIA_CACHE_METADATA } from '../../infrastructure/http/private-no-store.interceptor'
import { ProductsController } from '../products/products.controller'
import { PurchaseOrdersController } from '../purchase-orders/purchase-orders.controller'
import { SalesOrdersController } from '../sales-orders/sales-orders.controller'

/**
 * 缓存放宽的「清单契约」。
 *
 * 放宽只允许覆盖按资产标识不可变的商品素材内容路由——商品主路由 2 条，加上订单侧
 * 复用同一批主图的 12 条（`purchase-orders` 6 条 + `sales-orders` 6 条）。其余处理器
 * （列表、审核、编辑上下文、资金来源等）必须保持全局默认的 `private, no-store`：
 * 一旦有人给这些路由补标注，或删掉某条主图路由的标注，这里会立刻失败。
 */
const MARKED_HANDLERS = [
  [ProductsController, ['headMediaContent', 'getMediaContent']],
  [PurchaseOrdersController, [
    'headProductOptionMainImage',
    'getProductOptionMainImage',
    'headSourceSalesOrderLineMainImage',
    'getSourceSalesOrderLineMainImage',
    'headProductPreviewMainImage',
    'getProductPreviewMainImage',
  ]],
  [SalesOrdersController, [
    'headProductEditOptionMainImage',
    'getProductEditOptionMainImage',
    'headProductOptionMainImage',
    'getProductOptionMainImage',
    'headProductPreviewMainImage',
    'getProductPreviewMainImage',
  ]],
] as const

const UNMARKED_HANDLERS = [
  [ProductsController, ['list', 'getById', 'update']],
  [PurchaseOrdersController, ['review', 'sourceSalesOrders', 'sourceSalesOrderLines']],
  [SalesOrdersController, ['list', 'productEditContext', 'productEditOptions']],
] as const

function cacheMetadataOf(controller: object, method: string): unknown {
  const handler = (controller as Record<string, unknown>)[method]
  if (typeof handler !== 'function') {
    throw new Error(`handler ${method} is missing from the controller prototype`)
  }
  return Reflect.getMetadata(IMMUTABLE_MEDIA_CACHE_METADATA, handler)
}

describe('immutable media content cache rollout', () => {
  it('marks exactly the fourteen immutable product image content routes', () => {
    const marked: string[] = []

    for (const [controller, methods] of MARKED_HANDLERS) {
      for (const method of methods) {
        expect(cacheMetadataOf(controller.prototype, method)).toBe(true)
        marked.push(`${controller.name}.${method}`)
      }
    }

    // 清单本身也要防重复：同一处理器被写两次会掩盖漏标。
    expect(marked).toHaveLength(14)
    expect(new Set(marked).size).toBe(14)
  })

  it('keeps every other handler on the default private no-store policy', () => {
    for (const [controller, methods] of UNMARKED_HANDLERS) {
      for (const method of methods) {
        expect(cacheMetadataOf(controller.prototype, method)).toBeUndefined()
      }
    }
  })
})
