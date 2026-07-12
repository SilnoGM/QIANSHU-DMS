import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { HTTP_MODULES } from '../http.modules'
import { PrismaModule } from '../infrastructure/database/prisma.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      ignoreEnvVars: true,
    }),
    PrismaModule,
    ...HTTP_MODULES,
  ],
})
export class OpenApiModule {}
