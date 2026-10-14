<script setup lang="ts">
import type { InvoiceRequestDto } from '@/api/generated/types.gen'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import { useAppAuth } from '@/composables/app/auth'
import { resolveInvoiceFailureKey } from '../invoice-failure.logic'
import { isSettleable, resolveSettleRemaining, statusTagClass } from '../invoice-status.logic'

/** 开票审批详情：隐藏路由，只读展示，动作仍在列表页的弹窗里执行。 */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()
const canReview = computed(() => auth('invoice-requests:review'))

const detail = ref<InvoiceRequestDto | null>(null)
const photoUrl = ref<string | null>(null)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  if (!canReview.value) {
    return
  }
  error.value = null
  try {
    const id = String(route.params.id ?? '')
    const { data } = await invoiceRequestsApi.get(id, new AbortController().signal)
    detail.value = data
    if (data.documentMediaAssetId !== null) {
      const blob = await invoiceRequestsApi.documentBlob(id, new AbortController().signal)
      photoUrl.value = URL.createObjectURL(blob.data)
    }
  }
  catch (reason) {
    error.value = t(resolveInvoiceFailureKey(reason))
  }
}

onMounted(load)
onBeforeUnmount(() => {
  if (photoUrl.value !== null) {
    URL.revokeObjectURL(photoUrl.value)
  }
})
</script>

<template>
  <FaPageMain v-if="!canReview">
    <p class="text-muted-foreground py-12 text-center">
      {{ t('invoiceRequest.list.noPermission') }}
    </p>
  </FaPageMain>
  <FaPageMain v-else class="min-w-0">
    <div class="mx-auto flex flex-col gap-4 max-w-2xl w-full">
      <p v-if="error !== null" class="text-sm text-destructive">
        {{ error }}
      </p>
      <template v-if="detail !== null">
        <div class="flex gap-4 items-start justify-between">
          <div>
            <h2 class="text-base font-semibold">
              {{ detail.invoiceNo }}
            </h2>
            <p class="text-sm text-muted-foreground mt-1">
              {{ detail.buyerName }} · {{ detail.buyerTaxId }} · {{ detail.creatorName }}
            </p>
          </div>
          <FaTag variant="outline" class="qs-type-status-tag" :class="statusTagClass(detail.status)">
            {{ t(`invoiceRequest.status.${detail.status}`) }}
          </FaTag>
        </div>

        <table class="text-sm w-full">
          <thead class="text-muted-foreground text-left">
            <tr>
              <th class="font-medium py-1">
                {{ t('invoiceRequest.field.productName') }}
              </th>
              <th class="font-medium py-1 text-right">
                {{ t('invoiceRequest.field.quantity') }}
              </th>
              <th class="font-medium py-1 text-right">
                {{ t('invoiceRequest.field.unitPrice') }}
              </th>
              <th class="font-medium py-1 text-right">
                {{ t('invoiceRequest.field.amount') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in detail.lines" :key="line.lineNo" class="border-t border-border">
              <td class="py-1">
                {{ line.productName }}
              </td>
              <td class="py-1 text-right tabular-nums">
                {{ line.quantity }}
              </td>
              <td class="py-1 text-right tabular-nums">
                {{ line.unitPrice }}
              </td>
              <td class="py-1 text-right tabular-nums">
                {{ line.amount }}
              </td>
            </tr>
          </tbody>
        </table>

        <dl class="text-sm pt-3 border-t border-border gap-1 grid">
          <div class="flex justify-between">
            <dt>{{ t('invoiceRequest.field.salesAmount') }}</dt><dd class="tabular-nums">
              {{ detail.salesAmount }}
            </dd>
          </div>
          <div class="flex justify-between">
            <dt>{{ t('invoiceRequest.field.taxAmount') }}</dt><dd class="tabular-nums">
              {{ detail.taxAmount }}
            </dd>
          </div>
          <div class="font-semibold flex justify-between">
            <dt>{{ t('invoiceRequest.field.totalAmount') }}</dt><dd class="tabular-nums">
              {{ detail.totalAmount }}
            </dd>
          </div>
          <div class="flex gap-4 justify-between">
            <dt>{{ t('invoiceRequest.field.invoiceRemark') }}</dt><dd>{{ detail.invoiceRemark ?? '—' }}</dd>
          </div>
          <div class="flex gap-4 justify-between">
            <dt>{{ t('invoiceRequest.field.internalRemark') }}</dt><dd>{{ detail.internalRemark ?? '—' }}</dd>
          </div>
          <div class="flex gap-4 justify-between">
            <dt>{{ t('invoiceRequest.form.recipientSection') }}</dt><dd class="text-right">
              {{ detail.recipientName }} / {{ detail.recipientPhone }} / {{ detail.recipientAddress }}
            </dd>
          </div>
          <div v-if="detail.documentUploadedAt !== null" class="flex gap-4 justify-between">
            <dt>{{ t('invoiceRequest.detail.settleableAt') }}</dt>
            <dd>{{ isSettleable(detail.documentUploadedAt, new Date()) ? t('invoiceRequest.detail.settleable') : t('invoiceRequest.detail.settleWait', resolveSettleRemaining(detail.documentUploadedAt, new Date()) ?? { hours: 0, minutes: 0 }) }}</dd>
          </div>
          <div v-if="detail.settleAmountCny !== null" class="flex gap-4 justify-between">
            <dt>{{ t('invoiceRequest.approval.settleAmount') }}</dt><dd class="tabular-nums">
              {{ detail.settleAmountCny }}
            </dd>
          </div>
        </dl>

        <div>
          <p class="text-sm font-medium">
            {{ t('invoiceRequest.detail.document') }}
          </p>
          <img v-if="photoUrl !== null" :src="photoUrl" :alt="t('invoiceRequest.detail.document')" class="mt-2 border border-border rounded-md max-h-72 object-contain">
          <p v-else class="text-sm text-muted-foreground mt-1">
            {{ t('invoiceRequest.detail.documentNone') }}
          </p>
        </div>

        <div>
          <p class="text-sm font-medium">
            {{ t('invoiceRequest.detail.history') }}
          </p>
          <ul class="text-sm text-muted-foreground mt-2 flex flex-col gap-1">
            <li v-for="entry in detail.history" :key="entry.occurredAt + entry.action">
              {{ t(`invoiceRequest.status.${entry.toStatus}`) }} · {{ entry.actorName }} · {{ entry.occurredAt.slice(0, 19).replace('T', ' ') }}
              <span v-if="entry.reason !== null">· {{ entry.reason }}</span>
            </li>
          </ul>
        </div>
      </template>

      <div class="flex justify-end">
        <FaButton variant="outline" @click="router.push({ name: 'qsFinanceInvoicesApproval' })">
          {{ t('invoiceRequest.common.confirm') }}
        </FaButton>
      </div>
    </div>
  </FaPageMain>
</template>
