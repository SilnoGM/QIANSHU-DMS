import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { validateEnvironment } from './config/env.validation'
import appConfig from './config/app.config'

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      load: [appConfig],
      validate: validateEnvironment,
    }),
  ],
})
export class AppModule {}
