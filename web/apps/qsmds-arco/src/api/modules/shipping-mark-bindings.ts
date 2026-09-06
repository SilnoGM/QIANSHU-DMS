import type { AxiosInstance } from 'axios'
import type { SaveShippingMarkBindingDto, ShippingMarkBindingDto, ShippingMarkBindingPageDto, ShippingMarkBindingsListData, ShippingMarkBindingsOptionsData, ShippingMarkOptionsPageDto } from '../generated/types.gen'
import api from '../index'

export type BindingListQuery = NonNullable<ShippingMarkBindingsListData['query']>
export type BindingOptionsQuery = NonNullable<ShippingMarkBindingsOptionsData['query']>
/** 保存无自动重试；GET 的取消与身份隔离由页面持有，未知结果通过只读查询核对。 */
export function createShippingMarkBindingsApi(client: AxiosInstance) {
  return {
    list: (params: BindingListQuery, signal: AbortSignal) => client.get<ShippingMarkBindingPageDto>('purchase-shipping-mark-bindings', { params, signal, errorPresentation: 'local' }),
    options: (params: BindingOptionsQuery, signal: AbortSignal) => client.get<ShippingMarkOptionsPageDto>('purchase-shipping-mark-bindings/rule-options', { params, signal, errorPresentation: 'local' }),
    save: (supplierValue: string, data: SaveShippingMarkBindingDto) => client.put<ShippingMarkBindingDto>(`purchase-shipping-mark-bindings/${encodeURIComponent(supplierValue)}`, data, { errorPresentation: 'local', retry: false }),
  }
}
export default createShippingMarkBindingsApi(api)
