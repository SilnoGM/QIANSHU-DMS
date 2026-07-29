import type { AxiosInstance } from 'axios'
import type {
  ChangeCurrencyStatusRequestDto,
  CreateCurrencyRequestDto,
  CreateExchangeRateRequestDto,
  CurrenciesListData,
  CurrencyCatalogItemDto,
  CurrencyDto,
  CurrencyPageDto,
  ExchangeRateDto,
  ExchangeRatePageDto,
  ExchangeRatesListData,
  UpdateCurrencyRequestDto,
  UpdateExchangeRateRequestDto,
} from '../generated/types.gen'

import api from '../index'

export type CurrencyListQuery = NonNullable<CurrenciesListData['query']>
export type ExchangeRateListQuery
  = NonNullable<ExchangeRatesListData['query']>

function currencyPath(currencyId: string): string {
  return `currencies/${encodeURIComponent(currencyId)}`
}

function exchangeRatePath(exchangeRateId: string): string {
  return `exchange-rates/${encodeURIComponent(exchangeRateId)}`
}

/**
 * 货币与汇率 API 以 OpenAPI generated types 为唯一传输契约。
 *
 * factory 仅供 Node 契约测试注入 Axios recorder；正式运行复用应用级 Client。
 * 写请求显式禁止自动重试，避免网络抖动造成重复创建或覆盖较新的 version。
 */
export function createCurrenciesApi(client: AxiosInstance) {
  return {
    catalog: {
      list: (signal: AbortSignal) =>
        client.get<CurrencyCatalogItemDto[]>('currency-catalog', {
          errorPresentation: 'local',
          signal,
        }),
    },
    currencies: {
      list: (query: CurrencyListQuery, signal: AbortSignal) =>
        client.get<CurrencyPageDto>('currencies', {
          errorPresentation: 'local',
          params: query,
          signal,
        }),
      get: (currencyId: string, signal: AbortSignal) =>
        client.get<CurrencyDto>(currencyPath(currencyId), {
          errorPresentation: 'local',
          signal,
        }),
      create: (data: CreateCurrencyRequestDto) =>
        client.post<CurrencyDto>('currencies', data, {
          errorPresentation: 'local',
          retry: false,
        }),
      update: (currencyId: string, data: UpdateCurrencyRequestDto) =>
        client.patch<CurrencyDto>(currencyPath(currencyId), data, {
          errorPresentation: 'local',
          retry: false,
        }),
      enable: (
        currencyId: string,
        data: ChangeCurrencyStatusRequestDto,
      ) =>
        client.post<CurrencyDto>(
          `${currencyPath(currencyId)}/enable`,
          data,
          {
            errorPresentation: 'local',
            retry: false,
          },
        ),
      disable: (
        currencyId: string,
        data: ChangeCurrencyStatusRequestDto,
      ) =>
        client.post<CurrencyDto>(
          `${currencyPath(currencyId)}/disable`,
          data,
          {
            errorPresentation: 'local',
            retry: false,
          },
        ),
    },
    exchangeRates: {
      list: (query: ExchangeRateListQuery, signal: AbortSignal) =>
        client.get<ExchangeRatePageDto>('exchange-rates', {
          errorPresentation: 'local',
          params: query,
          signal,
        }),
      get: (exchangeRateId: string, signal: AbortSignal) =>
        client.get<ExchangeRateDto>(
          exchangeRatePath(exchangeRateId),
          {
            errorPresentation: 'local',
            signal,
          },
        ),
      create: (data: CreateExchangeRateRequestDto) =>
        client.post<ExchangeRateDto>('exchange-rates', data, {
          errorPresentation: 'local',
          retry: false,
        }),
      update: (
        exchangeRateId: string,
        data: UpdateExchangeRateRequestDto,
      ) =>
        client.patch<ExchangeRateDto>(
          exchangeRatePath(exchangeRateId),
          data,
          {
            errorPresentation: 'local',
            retry: false,
          },
        ),
    },
  }
}

export default createCurrenciesApi(api)
