import { PackagingCostModule } from './modules/packaging-costs/packaging-cost.module'
import { PaymentRecipientsModule } from './modules/payment-recipients/payment-recipients.module'
import { ContainerBatchModule } from './modules/container-batches/container-batch.module'
import { AuditModule } from './modules/audit/audit.module'
import { AuthModule } from './modules/auth/auth.module'
import { CurrencyModule } from './modules/currencies/currency.module'
import { DictionaryModule } from './modules/dictionaries/dictionary.module'
import { ExchangeRatesModule } from './modules/exchange-rates/exchange-rates.module'
import { FundAccountsModule } from './modules/fund-accounts/fund-accounts.module'
import { HealthModule } from './modules/health/health.module'
import { NumberingModule } from './modules/numbering/numbering.module'
import { PermissionsModule } from './modules/permissions/permissions.module'
import { ProfileModule } from './modules/profile/profile.module'
import { ProductsModule } from './modules/products/products.module'
import { PurchaseOrdersModule } from './modules/purchase-orders/purchase-orders.module'
import { PurchaseShippingMarksModule } from './modules/purchase-shipping-marks/purchase-shipping-marks.module'
import { RegionsModule } from './modules/regions/regions.module'
import { RolesModule } from './modules/roles/roles.module'
import { SalesOrdersModule } from './modules/sales-orders/sales-orders.module'
import { UsersModule } from './modules/users/users.module'

// 正式运行应用与 OpenAPI preview 必须消费同一清单，避免路由和快照随两份手工列表漂移。
export const HTTP_MODULES = [
  HealthModule,
  AuthModule,
  ProfileModule,
  UsersModule,
  RolesModule,
  PermissionsModule,
  DictionaryModule,
  CurrencyModule,
  ExchangeRatesModule,
  FundAccountsModule,
  RegionsModule,
  NumberingModule,
  ProductsModule,
  SalesOrdersModule,
  PurchaseOrdersModule,
  PurchaseShippingMarksModule,
  AuditModule,
  PackagingCostModule,
  PaymentRecipientsModule,
  ContainerBatchModule,
] as const
