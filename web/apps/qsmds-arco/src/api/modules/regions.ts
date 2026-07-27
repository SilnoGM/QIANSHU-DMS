import type { AxiosInstance } from 'axios'
import type {
  CreateRegionRequestDto,
  RegionDto,
  RegionMutationResultDto,
  RegionNavigationNodeDto,
  RegionOptionDto,
  RegionPageDto,
  RegionPathDto,
  RegionSearchResponseDto,
  RegionSelectionOptionsListData,
  RegionsListData,
  UpdateRegionRequestDto,
} from '../generated/types.gen'

import api from '../index'

type RegionSelectionOptionsQuery
  = NonNullable<RegionSelectionOptionsListData['query']>
type RegionListQuery = NonNullable<RegionsListData['query']>

function regionPath(regionId: string): string {
  return `regions/${encodeURIComponent(regionId)}`
}

/**
 * 地区 API 以 OpenAPI generated types 为唯一契约来源。
 *
 * factory 仅用于在 Node 契约测试中注入 Axios recorder；正式运行统一复用应用级
 * Axios client。所有错误由调用页面或 Provider 就地呈现，避免全局 Toast 与局部
 * loading/error surface 重复。
 */
export function createRegionsApi(client: AxiosInstance) {
  return {
    selection: {
      listOptions: (
        parentId: string | null,
        signal: AbortSignal,
      ) => {
        const params: RegionSelectionOptionsQuery | undefined
          = parentId === null ? undefined : { parentId }

        return client.get<RegionOptionDto[]>('region-selection/options', {
          errorPresentation: 'local',
          ...(params === undefined ? {} : { params }),
          signal,
        })
      },
      search: (query: string, signal: AbortSignal) =>
        client.get<RegionSearchResponseDto>('region-selection/search', {
          errorPresentation: 'local',
          params: {
            limit: 50,
            query,
          },
          signal,
        }),
      getPath: (cityId: string, signal: AbortSignal) =>
        client.get<RegionPathDto>(
          `region-selection/paths/${encodeURIComponent(cityId)}`,
          {
            errorPresentation: 'local',
            signal,
          },
        ),
    },
    management: {
      navigation: (signal: AbortSignal) =>
        client.get<RegionNavigationNodeDto[]>('regions/navigation', {
          errorPresentation: 'local',
          signal,
        }),
      list: (query: RegionListQuery, signal: AbortSignal) =>
        client.get<RegionPageDto>('regions', {
          errorPresentation: 'local',
          params: query,
          signal,
        }),
      get: (regionId: string, signal: AbortSignal) =>
        client.get<RegionDto>(regionPath(regionId), {
          errorPresentation: 'local',
          signal,
        }),
      create: (data: CreateRegionRequestDto) =>
        client.post<RegionDto>('regions', data, {
          errorPresentation: 'local',
          retry: false,
        }),
      update: (regionId: string, data: UpdateRegionRequestDto) =>
        client.patch<RegionDto>(regionPath(regionId), data, {
          errorPresentation: 'local',
          retry: false,
        }),
      enable: (regionId: string) =>
        client.post<RegionMutationResultDto>(
          `${regionPath(regionId)}/enable`,
          {},
          {
            errorPresentation: 'local',
            retry: false,
          },
        ),
      disable: (regionId: string) =>
        client.post<RegionMutationResultDto>(
          `${regionPath(regionId)}/disable`,
          {},
          {
            errorPresentation: 'local',
            retry: false,
          },
        ),
    },
  }
}

export default createRegionsApi(api)
