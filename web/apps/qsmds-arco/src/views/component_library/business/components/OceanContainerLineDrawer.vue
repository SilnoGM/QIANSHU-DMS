<script setup lang="ts">
import type { DemoOceanContainerLine } from '../fixtures/ocean-container.fixture'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import { oceanContainerCurrencies } from '../fixtures/ocean-container.fixture'

defineProps<{
  line: DemoOceanContainerLine | null
  containerName: string
}>()

const visible = defineModel<boolean>({ required: true })
</script>

<template>
  <QsGenericDrawer v-model="visible" title="装柜明细" :description="`${containerName} · 演示数据`" size="lg">
    <template #header-leading>
      <FaIcon name="i-lucide:package" class="size-4" />
    </template>
    <div v-if="line" class="space-y-6">
      <section>
        <h3 class="qs-type-compact-title m-0">
          {{ line.goodsName }}
        </h3>
        <div class="qs-type-data text-primary mt-3 break-all dark:text-primary-foreground">
          {{ line.oceanShippingMarkText || '—' }}
        </div>
        <dl class="m-0 mt-4 gap-4 grid sm:grid-cols-2">
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              货件唛头
            </dt>
            <dd class="qs-type-data m-0 mt-1 break-all">
              {{ line.shippingMark || '—' }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              销售订单
            </dt>
            <dd class="qs-type-data m-0 mt-1 break-all">
              {{ line.salesOrderNo || '—' }}
            </dd>
          </div>
        </dl>
      </section>
      <section class="pt-5 border-t border-border">
        <h3 class="qs-type-compact-title m-0 mb-4">
          收件人信息
        </h3>
        <div class="qs-type-body-medium flex flex-wrap gap-x-4 gap-y-1">
          <span>{{ line.recipientName || '—' }}</span>
          <span class="qs-type-data">{{ line.recipientPhone }}</span>
        </div>
        <p class="qs-type-description m-0 mt-2 break-words">
          {{ line.recipientAddress }}
        </p>
      </section>
      <dl class="m-0 pt-5 border-t border-border gap-4 grid sm:grid-cols-2">
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            整行毛重
          </dt>
          <dd class="qs-type-data m-0 mt-1">
            {{ line.grossWeightKg }} kg
          </dd>
        </div>
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            每件尺寸
          </dt>
          <dd class="qs-type-data m-0 mt-1">
            {{ line.dimensionsCm }} cm
          </dd>
        </div>
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            包装件数
          </dt>
          <dd class="qs-type-data m-0 mt-1">
            {{ line.packageCount }} 件
          </dd>
        </div>
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            代收货款
          </dt>
          <dd class="m-0 mt-1">
            <AmountDisplay :value="line.codAmountTwd" currency="TWD" :currencies="oceanContainerCurrencies" />
          </dd>
        </div>
      </dl>
      <section class="pt-5 border-t border-border">
        <h3 class="qs-type-compact-title m-0 mb-3">
          备注
        </h3>
        <p class="qs-type-description m-0 whitespace-pre-wrap break-words">
          {{ line.remark || '—' }}
        </p>
      </section>
    </div>
    <template #footer>
      <FaButton variant="outline" @click="visible = false">
        关闭
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
