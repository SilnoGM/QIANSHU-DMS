import type { RouteRecordRaw } from 'vue-router'

export const SUPPLIER_PAYMENT_PROFILE_PERMISSIONS = ['supplier-payment-profiles:read'] as const
const routes: RouteRecordRaw = {
  path: '/admin/supplier-payment-profiles',
  name: 'adminSupplierPaymentProfiles',
  component: () => import('@/views/admin/supplier-payment-profiles/index.vue'),
  meta: {
    title: '收款资料配置',
    icon: 'qs-fund-accounts',
    auth: [...SUPPLIER_PAYMENT_PROFILE_PERMISSIONS],
    singleMenu: true,
  },
}
export default routes
