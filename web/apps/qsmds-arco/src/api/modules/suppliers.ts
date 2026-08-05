import type { AxiosInstance } from 'axios'
import type {
  ChangeSupplierStatusRequestDto,
  CreateSupplierRequestDto,
  SupplierDto,
  SupplierPageDto,
  SuppliersListData,
  UpdateSupplierRequestDto,
} from '../generated/types.gen'

import api from '../index'

export type {
  CreateSupplierRequestDto,
  SupplierDto,
  SupplierListItemDto,
  SupplierPrimaryAddressDto,
  SupplierPrimaryContactDto,
  SupplierRegistrationDto,
  SupplierRegionReferenceDto,
  UpdateSupplierRequestDto,
} from '../generated/types.gen'

export type SupplierListQuery = NonNullable<SuppliersListData['query']>

function supplierPath(supplierId: string): string {
  return `suppliers/${encodeURIComponent(supplierId)}`
}

const LOCAL_MUTATION_CONFIG = {
  errorPresentation: 'local' as const,
  retry: false as const,
}

/**
 * Supplier API 只消费 OpenAPI generated types。读取显式接收 AbortSignal，所有写
 * 请求禁止 Axios 自动重试；创建幂等 key 由页面创建意图持有并逐次显式传入。
 */
export function createSuppliersApi(client: AxiosInstance) {
  return {
    list: (query: SupplierListQuery, signal: AbortSignal) =>
      client.get<SupplierPageDto>('suppliers', {
        errorPresentation: 'local',
        params: query,
        signal,
      }),
    get: (supplierId: string, signal: AbortSignal) =>
      client.get<SupplierDto>(supplierPath(supplierId), {
        errorPresentation: 'local',
        signal,
      }),
    create: (data: CreateSupplierRequestDto, idempotencyKey: string) =>
      client.post<SupplierDto>('suppliers', data, {
        ...LOCAL_MUTATION_CONFIG,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    update: (supplierId: string, data: UpdateSupplierRequestDto) =>
      client.patch<SupplierDto>(
        supplierPath(supplierId),
        data,
        LOCAL_MUTATION_CONFIG,
      ),
    enable: (
      supplierId: string,
      data: ChangeSupplierStatusRequestDto,
    ) => client.post<SupplierDto>(
      `${supplierPath(supplierId)}/enable`,
      data,
      LOCAL_MUTATION_CONFIG,
    ),
    disable: (
      supplierId: string,
      data: ChangeSupplierStatusRequestDto,
    ) => client.post<SupplierDto>(
      `${supplierPath(supplierId)}/disable`,
      data,
      LOCAL_MUTATION_CONFIG,
    ),
  }
}

export default createSuppliersApi(api)
