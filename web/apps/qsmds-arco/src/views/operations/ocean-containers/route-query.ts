import type { LocationQuery, LocationQueryRaw } from 'vue-router'
import type { OperationsOceanContainerQuery } from '@/api/modules/operations-ocean-containers'

export function parseOceanContainerQuery(query: LocationQuery): OperationsOceanContainerQuery {
  const page = Number(query.page)
  const pageSize = Number(query.pageSize)
  return {
    page: Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : 1,
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize : 10,
    search: typeof query.search === 'string' ? [...query.search.trim()].slice(0, 128).join('') || undefined : undefined,
  }
}

export function buildOceanContainerQuery(query: OperationsOceanContainerQuery): LocationQueryRaw {
  return {
    ...(query.search ? { search: query.search } : {}),
    ...((query.page ?? 1) > 1 ? { page: String(query.page) } : {}),
    ...((query.pageSize ?? 10) !== 10 ? { pageSize: String(query.pageSize) } : {}),
  }
}
