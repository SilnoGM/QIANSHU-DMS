<script setup lang="ts">
import type { ShippingMarkRuleSummaryDto } from '@/api/generated/types.gen'
import { isBindableRule } from './shipping-mark-binding.logic'
import ShippingMarkRulePicker from './shipping-mark-rule-picker.vue'

defineProps<{
  saving: boolean
  refreshing: boolean
  needsRefresh: boolean
  error: string
}>()
const emit = defineEmits<{
  save: []
  cancel: []
  refresh: []
}>()
const selection = defineModel<ShippingMarkRuleSummaryDto | null>({ required: true })
const { t } = useI18n()
</script>

<template>
  <div class="mt-3 p-3 border border-primary/25 rounded-lg bg-primary/5 min-w-0 space-y-3" data-testid="shipping-mark-binding-editor">
    <ShippingMarkRulePicker v-model="selection" :disabled="saving || refreshing" />
    <p class="text-xs text-muted-foreground m-0 whitespace-normal">
      {{ t('shippingMarkBinding.sharedSequence') }}
    </p>
    <p v-if="error" class="text-sm m-0 whitespace-normal" :class="needsRefresh ? 'text-destructive' : 'text-muted-foreground'" role="alert">
      {{ error }}
    </p>
    <div class="flex flex-wrap gap-2">
      <FaButton size="sm" :disabled="saving || refreshing || needsRefresh || !isBindableRule(selection)" :loading="saving" @click="emit('save')">
        {{ t('shippingMarkBinding.save') }}
      </FaButton>
      <FaButton v-if="needsRefresh" size="sm" variant="outline" :disabled="saving || refreshing" :loading="refreshing" @click="emit('refresh')">
        {{ t('shippingMarkBinding.refresh') }}
      </FaButton>
      <FaButton size="sm" variant="outline" :disabled="saving || refreshing" @click="emit('cancel')">
        {{ t('shippingMarkBinding.cancel') }}
      </FaButton>
    </div>
  </div>
</template>
