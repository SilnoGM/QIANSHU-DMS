import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { validateEnvironment } from './config/env.validation'
import appConfig from './config/app.config'
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
  ],
})
export class AppModule {}
