import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'

import { validateEnvironment } from './config/env.validation'
import appConfig from './config/app.config'
import authConfig from './config/auth.config'
import { HTTP_MODULES } from './http.modules'
import { PrismaModule } from './infrastructure/database/prisma.module'
import { PrivateNoStoreInterceptor } from './infrastructure/http/private-no-store.interceptor'
import { CsrfProtectionGuard } from './modules/auth/guards/csrf-protection.guard'

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      load: [appConfig, authConfig],
      validate: validateEnvironment,
    }),
    PrismaModule,
    ...HTTP_MODULES,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CsrfProtectionGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: PrivateNoStoreInterceptor,
    },
  ],
})
export class AppModule {}
