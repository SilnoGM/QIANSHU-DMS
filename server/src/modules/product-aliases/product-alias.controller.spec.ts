import { Reflector } from '@nestjs/core'

import { requestIdMiddleware } from '../../infrastructure/http/request-id.middleware'
import { attachRequestAuthContext } from '../auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { ProductAliasController } from './product-alias.controller'
import type { ProductAliasService } from './product-alias.service'

const ACTOR = 'c1a2b3c4-d5e6-47f8-9a0b-c1d2e3f4a5b6'
const SESSION_ID = 'd1a2b3c4-d5e6-47f8-9a0b-c1d2e3f4a5b6'
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: SESSION_ID,
    userId: ACTOR,
    username: 'alias_operator',
    displayName: '测试运营',
    mustChangePassword: false,
    createdAt: new Date('2026-11-17T00:00:00.000Z'),
    lastActivityAt: new Date('2026-11-17T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-11-18T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-12-17T00:00:00.000Z'),
  })
  return request
}

function permissionsOf(method: keyof ProductAliasController): unknown {
  return new Reflector().get(REQUIRED_PERMISSIONS_METADATA, ProductAliasController.prototype[method])
}

describe('ProductAliasController', () => {
  it('reads only the current user aliases under product-aliases:manage', async () => {
    const aliases = {
      listMine: jest.fn().mockResolvedValue({ items: [] }),
      upsert: jest.fn(),
      clear: jest.fn(),
    }
    const controller = new ProductAliasController(aliases as unknown as ProductAliasService)
    await expect(controller.list({ productIds: PRODUCT_ID }, ACTOR)).resolves.toEqual({ items: [] })
    expect(aliases.listMine).toHaveBeenCalledWith(ACTOR, { productIds: PRODUCT_ID })
    expect(permissionsOf('list')).toEqual(['product-aliases:manage'])
  })

  it('passes the trusted actor and request id into upsert and clear', async () => {
    const aliases = {
      listMine: jest.fn(),
      upsert: jest.fn().mockResolvedValue({
        productId: PRODUCT_ID,
        alias: '破碎机',
        updatedAt: '2026-11-17T00:00:00.000Z',
      }),
      clear: jest.fn().mockResolvedValue(undefined),
    }
    const controller = new ProductAliasController(aliases as unknown as ProductAliasService)
    const request = createRequest()

    await controller.upsert({ productId: PRODUCT_ID }, { alias: '破碎机' }, request)
    expect(aliases.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR, requestId: expect.any(String) as unknown }),
      PRODUCT_ID,
      { alias: '破碎机' },
    )
    await controller.clear({ productId: PRODUCT_ID }, request)
    expect(aliases.clear).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR }),
      PRODUCT_ID,
    )
    expect(permissionsOf('upsert')).toEqual(['product-aliases:manage'])
    expect(permissionsOf('clear')).toEqual(['product-aliases:manage'])
  })
})
