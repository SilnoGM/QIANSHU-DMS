<script setup lang="ts">
import type { PurchaseOrderShippingMarkResolutionDto } from '@/api/generated/types.gen'
import { Popover as APopover } from '@arco-design/web-vue'
import { useEventListener, useMediaQuery } from '@vueuse/core'
import { computed, ref, useId, watch } from 'vue'
import { formatNumberingRuleStructure, numberingResetPolicyLabel } from '../../system/basic-data/numbering/numbering-list.logic'
import { isPurchaseOrderShippingMarkAvailable, PURCHASE_SHIPPING_MARK_DISPATCH_HINT } from './purchase-order-shipping-mark.logic'

const props = defineProps<{
  resolution: PurchaseOrderShippingMarkResolutionDto | null
  loading?: boolean
  error?: string
}>()

const detailsOpen = ref(false)
const { t } = useI18n()
const detailsId = useId()
// 触控设备的合成 mouseleave 会关闭刚点开的 hover 浮层，按输入能力启用悬停。
const supportsHover = useMediaQuery('(hover: hover) and (pointer: fine)')
const available = computed(() => isPurchaseOrderShippingMarkAvailable(props.resolution))
const structure = computed(() => props.resolution?.activeConfig
  ? formatNumberingRuleStructure(props.resolution.activeConfig)
  : '')
const failure = computed(() => available.value ? '' : props.error || props.resolution?.message || '请先完成唛头规则配置。')

// 摘要只展示调用方传入的快照，不重新解析或请求规则，保留提交结果未知时的冻结语义。
watch(() => [props.resolution, props.loading], () => {
  detailsOpen.value = false
})
useEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && detailsOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    detailsOpen.value = false
  }
}, { capture: true })
</script>

<template>
  <div class="text-foreground min-w-0" data-testid="purchase-order-shipping-mark-summary" :aria-busy="loading">
    <p v-if="loading" class="text-sm text-muted-foreground leading-6 m-0" role="status">
      正在匹配采购唛头规则…
    </p>
    <template v-else>
      <div class="flex gap-2 min-w-0 items-center">
        <p class="text-sm font-medium m-0 min-w-0 [overflow-wrap:anywhere]" data-testid="shipping-mark-summary-name">
          {{ resolution?.name || '尚未匹配唛头规则' }}
        </p>
        <FaTag
          variant="outline"
          class="ml-auto shrink-0"
          :class="available ? 'border-primary/25 bg-primary/5 text-primary' : 'border-destructive/25 bg-destructive/5 text-destructive'"
          data-testid="shipping-mark-summary-status"
        >
          {{ available ? '可用' : '不可用' }}
        </FaTag>
        <!-- 不在焦点进入时展开，避免模态自动聚焦直接弹出详情；键盘通过 Enter/Space 激活按钮。
             使用透传 style 覆盖 Arco 内部层级：高于 FaModal 的 2000，并恢复模态期间的指针交互。 -->
        <APopover
          v-if="resolution"
          v-model:popup-visible="detailsOpen"
          :trigger="supportsHover ? ['hover', 'click'] : ['click']"
          :click-to-close="false"
          :mouse-enter-delay="200"
          :mouse-leave-delay="150"
          :style="{ zIndex: 2001, pointerEvents: 'auto' }"
          position="br"
          content-class="bg-background! border-border! p-3!"
          arrow-class="bg-background! border-border!"
        >
          <FaButton
            type="button"
            variant="ghost"
            size="icon"
            class="text-muted-foreground shrink-0 size-11 sm:size-7"
            aria-label="查看唛头规则详情"
            aria-haspopup="dialog"
            :aria-expanded="detailsOpen"
            :aria-controls="detailsId"
          >
            <FaIcon name="i-lucide:info" class="size-4" aria-hidden="true" />
          </FaButton>
          <template #content>
            <div :id="detailsId" class="text-foreground max-w-[calc(100vw-64px)] w-72" role="dialog" aria-label="唛头规则详情" data-testid="shipping-mark-summary-details">
              <dl class="text-sm leading-6 m-0 gap-x-3 gap-y-1 grid grid-cols-[auto_minmax(0,1fr)]">
                <dt class="text-muted-foreground">
                  规则编码
                </dt>
                <dd class="font-qs-data-mono m-0 break-all">
                  {{ resolution.ruleCode || '-' }}
                </dd>
                <dt class="text-muted-foreground">
                  匹配来源
                </dt>
                <dd class="m-0">
                  {{ resolution.matchSource === 'CUSTOM_RULE' ? '自定义采购固定规则' : '供应商绑定规则' }}
                </dd>
                <dt class="text-muted-foreground">
                  生效版本
                </dt>
                <dd class="m-0">
                  {{ resolution.activeRevision === null ? '无生效版本' : `第 ${resolution.activeRevision} 版` }}
                </dd>
                <template v-if="resolution.activeConfig">
                  <dt class="text-muted-foreground">
                    重置周期
                  </dt>
                  <dd class="m-0">
                    {{ numberingResetPolicyLabel(resolution.activeConfig.resetPolicy) }}
                  </dd>
                  <dt class="text-muted-foreground">
                    时区
                  </dt>
                  <dd class="font-qs-data-mono m-0 break-all">
                    {{ resolution.activeConfig.timezone }}
                  </dd>
                  <dt class="text-muted-foreground">
                    最长长度
                  </dt>
                  <dd class="m-0">
                    {{ resolution.activeConfig.maxOutputLength }} 位
                  </dd>
                </template>
              </dl>
              <p class="text-xs text-muted-foreground leading-relaxed m-0 mt-2">
                {{ t(PURCHASE_SHIPPING_MARK_DISPATCH_HINT) }}
              </p>
            </div>
          </template>
        </APopover>
      </div>
      <p v-if="structure" class="font-qs-data-mono text-sm leading-5 m-0 mt-1 [overflow-wrap:anywhere]" aria-label="编号结构" data-testid="shipping-mark-summary-structure">
        {{ structure }}
      </p>
      <p class="text-xs text-muted-foreground leading-5 m-0 mt-1" data-testid="shipping-mark-summary-hint">
        {{ t('purchaseOrderParts.reviewDispatch') }}
      </p>
      <p v-if="failure" class="text-sm text-destructive leading-5 m-0 mt-1 [overflow-wrap:anywhere]" role="alert">
        {{ failure }}
      </p>
    </template>
  </div>
</template>
