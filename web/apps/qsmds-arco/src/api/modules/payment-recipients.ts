import type { AxiosInstance } from 'axios'
import type { PackagingPaymentProfileDto, PaymentRecipientAccountInputDto, PaymentRecipientImageUploadDto, SupplierPaymentProfileDto, SupplierPaymentProfilePageDto, SupplierPaymentProfileSaveDto } from '../generated/types.gen'
import api from '../index'

export type { PackagingPaymentProfileDto, PaymentRecipientAccountDto, PaymentRecipientAccountInputDto, PaymentRecipientProfileDto, SupplierPaymentProfileDto } from '../generated/types.gen'
export type PaymentRecipientMethod = PaymentRecipientAccountInputDto['paymentMethod']
export interface SupplierPaymentProfileQuery { page: number, pageSize: number, keyword?: string }
export type SaveSupplierPaymentProfileDto = SupplierPaymentProfileSaveDto

/** 二维码始终通过认证客户端读取 Blob；临时上传与版本化保存均不自动重试。 */
export function createPaymentRecipientsApi(client: AxiosInstance) {
  return {
    list: (params: SupplierPaymentProfileQuery, signal?: AbortSignal) => client.get<SupplierPaymentProfilePageDto>('supplier-payment-profiles', { params, signal, errorPresentation: 'local' }),
    save: (supplierValue: string, data: SaveSupplierPaymentProfileDto, signal?: AbortSignal) => client.put<SupplierPaymentProfileDto>(`supplier-payment-profiles/${encodeURIComponent(supplierValue)}`, data, { signal, errorPresentation: 'local', retry: false }),
    getPackagingProfile: (vendor: 'CHENGXIN', signal?: AbortSignal) => client.get<PackagingPaymentProfileDto>(`packaging-payment-profiles/${vendor}`, { signal, errorPresentation: 'local' }),
    savePackagingProfile: (vendor: 'CHENGXIN', data: SaveSupplierPaymentProfileDto, signal?: AbortSignal) => client.put<PackagingPaymentProfileDto>(`packaging-payment-profiles/${vendor}`, data, { signal, errorPresentation: 'local', retry: false }),
    upload: (file: File, signal?: AbortSignal) => {
      const body = new FormData()
      body.append('mediaType', 'IMAGE')
      body.append('file', file, file.name)
      return client.post<PaymentRecipientImageUploadDto>('payment-recipient-images', body, { signal, errorPresentation: 'local', retry: false })
    },
    contentBlob: (mediaAssetId: string, signal?: AbortSignal) => client.get<Blob>(`payment-recipient-images/${encodeURIComponent(mediaAssetId)}/content`, { signal, responseType: 'blob', errorPresentation: 'local' }),
  }
}
export default createPaymentRecipientsApi(api)
