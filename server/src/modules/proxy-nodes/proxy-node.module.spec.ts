import { HTTP_MODULES } from '../../http.modules'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { IpfoxyClient } from './ipfoxy.client'
import { ProxyNodeCommandService } from './proxy-node-command.service'
import { ProxyNodeController } from './proxy-node.controller'
import { ProxyNodeQueryService } from './proxy-node-query.service'
import { ProxyNodeSecretService } from './proxy-node-secret.service'
import { ProxyNodesModule } from './proxy-node.module'

describe('ProxyNodesModule metadata', () => {
  it('composes the shared database/auth providers and the HTTP boundary', () => {
    expect(Reflect.getMetadata('imports', ProxyNodesModule)).toEqual([
      PrismaModule,
      AuthModule,
    ])
    expect(Reflect.getMetadata('controllers', ProxyNodesModule)).toEqual([
      ProxyNodeController,
    ])

    const providers = Reflect.getMetadata('providers', ProxyNodesModule) as unknown[]
    expect(providers).toEqual(expect.arrayContaining([
      IpfoxyClient,
      ProxyNodeSecretService,
      ProxyNodeQueryService,
      ProxyNodeCommandService,
    ]))
    expect(Reflect.getMetadata('exports', ProxyNodesModule)).toBeUndefined()
  })

  it('is registered in the single live HTTP/OpenAPI module list', () => {
    expect(HTTP_MODULES).toContain(ProxyNodesModule)
  })
})
