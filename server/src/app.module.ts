import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { validateEnvironment } from './config/env.validation'
import appConfig from './config/app.config'
import { HTTP_MODULES } from './http.modules'
import { PrismaModule } from './infrastructure/database/prisma.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      load: [appConfig],
      validate: validateEnvironment,
    }),
    PrismaModule,
    ...HTTP_MODULES,
  ],
})
export class AppModule {}
