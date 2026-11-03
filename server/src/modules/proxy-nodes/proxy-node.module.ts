import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { IpfoxyConfiguration } from '../../config/ipfoxy.config'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import {
  IpfoxyClient,
  IPFOXY_CONFIG,
  IPFOXY_FETCH,
  type IpfoxyCredentials,
} from './ipfoxy.client'
import { ProxyNodeCommandService } from './proxy-node-command.service'
import { ProxyNodeController } from './proxy-node.controller'
import { ProxyNodeQueryService } from './proxy-node-query.service'
import {
  PROXY_NODE_SECRET_KEY,
  ProxyNodeSecretService,
} from './proxy-node-secret.service'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ProxyNodeController],
  providers: [
    {
      provide: IPFOXY_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): IpfoxyCredentials => ({
        apiId: config.get<string>('IPFOXY_API_ID') ?? null,
        apiToken: config.get<string>('IPFOXY_API_TOKEN') ?? null,
        baseUrl: config.getOrThrow<IpfoxyConfiguration>('ipfoxy').baseUrl,
      }),
    },
    {
      provide: IPFOXY_FETCH,
      useValue: globalThis.fetch,
    },
    {
      provide: PROXY_NODE_SECRET_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): string | null =>
        config.get<string>('PROXY_NODE_SECRET_KEY') ?? null,
    },
    IpfoxyClient,
    ProxyNodeSecretService,
    ProxyNodeQueryService,
    ProxyNodeCommandService,
  ],
})
export class ProxyNodesModule {}
