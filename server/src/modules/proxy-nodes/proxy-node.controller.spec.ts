import { HttpStatus } from '@nestjs/common'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants'

import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { ProxyNodeController } from './proxy-node.controller'

function permissionsOf(
  method: keyof ProxyNodeController,
): readonly string[] {
  return Reflect.getMetadata(
    REQUIRED_PERMISSIONS_METADATA,
    ProxyNodeController.prototype[method],
  ) as readonly string[]
}

describe('ProxyNodeController contracts', () => {
  it('separates personal reads from management mutations by permission', () => {
    expect(permissionsOf('mine')).toEqual(['proxy-nodes:read'])
    expect(permissionsOf('mineExpirySummary')).toEqual(['proxy-nodes:read'])
    expect(permissionsOf('list')).toEqual(['proxy-nodes:manage'])
    expect(permissionsOf('expirySummary')).toEqual(['proxy-nodes:manage'])
    expect(permissionsOf('assignableUsers')).toEqual(['proxy-nodes:manage'])
    expect(permissionsOf('sync')).toEqual(['proxy-nodes:manage'])
    expect(permissionsOf('assign')).toEqual(['proxy-nodes:manage'])
    expect(permissionsOf('release')).toEqual(['proxy-nodes:manage'])
  })

  it('returns 200 for command endpoints', () => {
    for (const method of ['sync', 'assign', 'release'] as const) {
      expect(Reflect.getMetadata(
        HTTP_CODE_METADATA,
        ProxyNodeController.prototype[method],
      )).toBe(HttpStatus.OK)
    }
  })
})
