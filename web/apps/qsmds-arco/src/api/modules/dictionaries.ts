import type { AxiosInstance } from 'axios'
import type {
  ChangeDictionaryStatusRequestDto,
  CreateDictionaryItemRequestDto,
  CreateDictionaryTypeRequestDto,
  DictionaryCatalogBatchDto,
  DictionaryCatalogBatchListData,
  DictionaryCatalogDto,
  DictionaryItemDto,
  DictionaryItemPageDto,
  DictionaryItemsListData,
  DictionaryTypeDto,
  DictionaryTypePageDto,
  DictionaryTypesListData,
  UpdateDictionaryItemRequestDto,
  UpdateDictionaryTypeRequestDto,
} from '../generated/types.gen'

import api from '../index'

export type DictionaryCatalogBatchCodes
  = NonNullable<DictionaryCatalogBatchListData['query']>['codes']
export type DictionaryTypeListQuery
  = NonNullable<DictionaryTypesListData['query']>
export type DictionaryItemListQuery
  = NonNullable<DictionaryItemsListData['query']>

const LOCAL_MUTATION_CONFIG = {
  errorPresentation: 'local' as const,
  retry: false as const,
}

function dictionaryCatalogPath(code: string): string {
  return `dictionary-catalog/${encodeURIComponent(code)}`
}

function dictionaryTypePath(typeId: string): string {
  return `dictionary-types/${encodeURIComponent(typeId)}`
}

function dictionaryItemPath(typeId: string, itemId: string): string {
  return `${dictionaryTypePath(typeId)}/items/${encodeURIComponent(itemId)}`
}

/**
 * 把批量目录 code 固化为 repeated query parameter。
 *
 * Axios 对数组参数的默认表示是 `codes[]=a&codes[]=b`，而公开契约要求
 * `codes=a&codes=b`。这里直接构造独立 URLSearchParams，既避免依赖全局 Client
 * 的 serializer 配置，也避免调用方在请求发出后修改原数组影响线协议。
 */
function createCatalogBatchParams(
  codes: DictionaryCatalogBatchCodes,
): URLSearchParams {
  const params = new URLSearchParams()
  for (const code of codes) {
    params.append('codes', code)
  }
  return params
}

/**
 * 系统字典 API 只使用 OpenAPI generated types 作为传输真相源。
 *
 * factory 仅供 Node 契约测试注入 Axios recorder；正式运行复用应用级 Client。
 * 所有读取都由调用方传入 AbortSignal 并在局部呈错；所有写请求显式关闭重试，
 * 避免网络结果未知时重放 Mutation。方法直接返回 Axios Promise，调用方继续持有
 * 完整 AxiosResponse，并在自己的可信边界显式读取和校验 `response.data`。
 */
export function createDictionariesApi(client: AxiosInstance) {
  return {
    catalog: {
      get: (code: string, signal: AbortSignal) =>
        client.get<DictionaryCatalogDto>(dictionaryCatalogPath(code), {
          errorPresentation: 'local',
          signal,
        }),
      batch: (
        codes: DictionaryCatalogBatchCodes,
        signal: AbortSignal,
      ) => client.get<DictionaryCatalogBatchDto>('dictionary-catalog', {
        errorPresentation: 'local',
        params: createCatalogBatchParams(codes),
        signal,
      }),
    },
    types: {
      list: (query: DictionaryTypeListQuery, signal: AbortSignal) =>
        client.get<DictionaryTypePageDto>('dictionary-types', {
          errorPresentation: 'local',
          params: query,
          signal,
        }),
      get: (typeId: string, signal: AbortSignal) =>
        client.get<DictionaryTypeDto>(dictionaryTypePath(typeId), {
          errorPresentation: 'local',
          signal,
        }),
      create: (data: CreateDictionaryTypeRequestDto) =>
        client.post<DictionaryTypeDto>(
          'dictionary-types',
          data,
          LOCAL_MUTATION_CONFIG,
        ),
      update: (
        typeId: string,
        data: UpdateDictionaryTypeRequestDto,
      ) => client.patch<DictionaryTypeDto>(
        dictionaryTypePath(typeId),
        data,
        LOCAL_MUTATION_CONFIG,
      ),
      enable: (
        typeId: string,
        data: ChangeDictionaryStatusRequestDto,
      ) => client.post<DictionaryTypeDto>(
        `${dictionaryTypePath(typeId)}/enable`,
        data,
        LOCAL_MUTATION_CONFIG,
      ),
      disable: (
        typeId: string,
        data: ChangeDictionaryStatusRequestDto,
      ) => client.post<DictionaryTypeDto>(
        `${dictionaryTypePath(typeId)}/disable`,
        data,
        LOCAL_MUTATION_CONFIG,
      ),
    },
    items: {
      list: (
        typeId: string,
        query: DictionaryItemListQuery,
        signal: AbortSignal,
      ) => client.get<DictionaryItemPageDto>(
        `${dictionaryTypePath(typeId)}/items`,
        {
          errorPresentation: 'local',
          params: query,
          signal,
        },
      ),
      get: (
        typeId: string,
        itemId: string,
        signal: AbortSignal,
      ) => client.get<DictionaryItemDto>(
        dictionaryItemPath(typeId, itemId),
        {
          errorPresentation: 'local',
          signal,
        },
      ),
      create: (
        typeId: string,
        data: CreateDictionaryItemRequestDto,
      ) => client.post<DictionaryItemDto>(
        `${dictionaryTypePath(typeId)}/items`,
        data,
        LOCAL_MUTATION_CONFIG,
      ),
      update: (
        typeId: string,
        itemId: string,
        data: UpdateDictionaryItemRequestDto,
      ) => client.patch<DictionaryItemDto>(
        dictionaryItemPath(typeId, itemId),
        data,
        LOCAL_MUTATION_CONFIG,
      ),
      enable: (
        typeId: string,
        itemId: string,
        data: ChangeDictionaryStatusRequestDto,
      ) => client.post<DictionaryItemDto>(
        `${dictionaryItemPath(typeId, itemId)}/enable`,
        data,
        LOCAL_MUTATION_CONFIG,
      ),
      disable: (
        typeId: string,
        itemId: string,
        data: ChangeDictionaryStatusRequestDto,
      ) => client.post<DictionaryItemDto>(
        `${dictionaryItemPath(typeId, itemId)}/disable`,
        data,
        LOCAL_MUTATION_CONFIG,
      ),
    },
  }
}

export default createDictionariesApi(api)
