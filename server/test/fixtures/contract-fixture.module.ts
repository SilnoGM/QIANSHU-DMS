import { Module } from '@nestjs/common'

import { ContractFixtureController } from './contract-fixture.controller'

@Module({
  controllers: [ContractFixtureController],
})
export class ContractFixtureModule {}
