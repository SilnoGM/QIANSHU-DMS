import type { AxiosInstance } from 'axios'
import type { ExchangeRatePageDto } from '../generated/types.gen'
import api from '../index'

const read = (signal: AbortSignal) => ({ signal, errorPresentation: 'local' as const })

/**
 * 只读汇率接口：当前系统汇率按币种给出（`foreignUnitsPerCny` = 1 人民币可换多少外币单位）。
 * 目前只有「对账信息」弹窗用它取台币口径的系统汇率。
 */
export function createExchangeRatesApi(client: AxiosInstance) {
  return {
    list: (signal: AbortSignal) => client.get<ExchangeRatePageDto>('exchange-rates', {
      ...read(signal),
      params: { page: 1, pageSize: 100 },
    }),
  }
}

export default createExchangeRatesApi(api)
