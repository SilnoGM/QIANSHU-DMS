<script setup lang="ts">
import type {
  QsGenericModalCloseReason,
  QsGenericModalSize,
} from '@/components/business/QsGenericModal/logic'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

defineOptions({ name: 'GenericModalShowcase' })

const demoStateValues = ['ready', 'long-content', 'loading', 'error'] as const
type DemoState = typeof demoStateValues[number]

const modalSizes = ['sm', 'md', 'lg', 'xl'] as const
/**
 * 使用确定性的本地费用行主动撑高正文，保证 Showcase 不依赖接口也能反复验收：
 * 模态框整体高度受视口约束，Header 与 Footer 稳定，只有中间正文产生滚动。
 */
const longContentItems = [
  { amount: 'CNY 8,600.00', code: 'OCEAN_FREIGHT', name: '海运费', note: '上海港 → 鹿特丹港' },
  { amount: 'CNY 2,180.00', code: 'ORIGIN_THC', name: '起运港码头费', note: '20GP × 2' },
  { amount: 'CNY 1,260.00', code: 'DOCUMENT', name: '文件费', note: '提单与舱单申报' },
  { amount: 'CNY 3,420.00', code: 'TRUCKING', name: '境内拖车费', note: '苏州仓 → 上海港' },
  { amount: 'CNY 980.00', code: 'CUSTOMS', name: '出口报关费', note: '一般贸易报关' },
  { amount: 'CNY 4,800.00', code: 'DESTINATION_THC', name: '目的港码头费', note: 'Rotterdam Terminal' },
  { amount: 'CNY 2,760.00', code: 'DELIVERY_ORDER', name: '换单服务费', note: '目的港代理服务' },
  { amount: 'CNY 1,540.00', code: 'SECURITY', name: '港口安保费', note: 'ISPS surcharge' },
  { amount: 'CNY 1,320.00', code: 'VGM', name: '称重与 VGM 申报', note: 'Verified Gross Mass' },
  { amount: 'CNY 1,600.00', code: 'HANDLING', name: '操作服务费', note: '全程单证与节点跟进' },
] as const
const stateDefinitions: Record<DemoState, {
  description: string
  icon: string
  label: string
}> = {
  'error': {
    description: '正文内联错误与重试入口',
    icon: 'i-lucide:circle-alert',
    label: '错误状态',
  },
  'loading': {
    description: '稳定骨架保留对话框尺寸',
    icon: 'i-lucide:loader-circle',
    label: '加载状态',
  },
  'long-content': {
    description: '固定首尾，仅正文区域滚动',
    icon: 'i-lucide:scroll-text',
    label: '长内容滚动',
  },
  'ready': {
    description: '完整标题、正文与操作区',
    icon: 'i-lucide:layout-template',
    label: '标准内容',
  },
}
const demoStates = demoStateValues.map(value => ({
  ...stateDefinitions[value],
  value,
}))

const visible = ref(false)
const selectedSize = ref<QsGenericModalSize>('md')
const selectedState = ref<DemoState>('ready')
const submitting = ref(false)
const guardEnabled = ref(false)
const lastEvent = ref('等待打开')
const lastCloseReason = ref('尚未触发')

const modalError = computed(() => selectedState.value === 'error'
  ? '暂时无法读取费用复核信息，请检查网络后重试。'
  : null)

function openModal() {
  visible.value = true
  lastEvent.value = `open · ${selectedSize.value}`
}

function selectState(state: DemoState) {
  selectedState.value = state
}

function selectSize(size: QsGenericModalSize) {
  selectedSize.value = size
}

function handleBeforeClose(reason: QsGenericModalCloseReason) {
  lastCloseReason.value = reason

  if (guardEnabled.value) {
    lastEvent.value = `blocked · ${reason}`
    return false
  }

  lastEvent.value = `closing · ${reason}`
  return true
}

function handleOpened() {
  lastEvent.value = 'opened · 动画完成'
}

function handleClosed() {
  lastEvent.value = 'closed · 焦点已恢复'
}

function retryContent() {
  selectedState.value = 'ready'
  lastEvent.value = 'retry · 已恢复标准内容'
}

async function simulateSubmit() {
  submitting.value = true
  lastEvent.value = 'submitting · 禁止关闭'

  await new Promise(resolve => setTimeout(resolve, 900))

  submitting.value = false
  guardEnabled.value = false
  lastEvent.value = 'submit-success · 准备关闭'
  visible.value = false
}
</script>

<template>
  <section aria-labelledby="generic-modal-title">
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:panels-top-left" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">聚焦任务对话</span>
          </div>
          <h3 id="generic-modal-title" class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl">
            业务通用模态框
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            选择尺寸和内容状态后打开模态框。示例只使用本地确定性数据，便于独立验收正文滚动、关闭守卫和响应式布局。
          </p>
        </div>
        <FaTag variant="secondary">
          QsGenericModal
        </FaTag>
      </div>

      <div class="mt-6 gap-5 grid lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)]">
        <div class="p-4 border border-border rounded-lg bg-muted/20 sm:p-5">
          <div class="gap-5 grid">
            <fieldset class="m-0 p-0 border-0">
              <legend class="qs-type-compact-label mb-2">
                内容状态
              </legend>
              <div class="gap-2 grid sm:grid-cols-2 xl:grid-cols-4">
                <button
                  v-for="state in demoStates"
                  :key="state.value"
                  type="button"
                  :data-testid="`generic-modal-state-${state.value}`"
                  class="p-3 text-start border rounded-lg bg-background transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  :class="selectedState === state.value
                    ? 'border-primary ring-1 ring-primary/20'
                    : 'border-border hover:border-primary/40'"
                  :aria-pressed="selectedState === state.value"
                  @click="selectState(state.value)"
                >
                  <span class="flex gap-2 items-center">
                    <FaIcon :name="state.icon" class="text-primary size-4" />
                    <strong class="qs-type-body-medium">{{ state.label }}</strong>
                  </span>
                  <span class="qs-type-meta text-muted-foreground mt-1.5 block">
                    {{ state.description }}
                  </span>
                </button>
              </div>
            </fieldset>

            <fieldset class="m-0 p-0 border-0">
              <legend class="qs-type-compact-label mb-2">
                对话框尺寸
              </legend>
              <div class="p-1 border border-border rounded-lg bg-background flex gap-1 max-w-md">
                <button
                  v-for="size in modalSizes"
                  :key="size"
                  type="button"
                  :data-testid="`generic-modal-size-${size}`"
                  class="text-xs rounded-md flex-1 h-8 uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="selectedSize === size
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
                  :aria-pressed="selectedSize === size"
                  @click="selectSize(size)"
                >
                  {{ size }}
                </button>
              </div>
            </fieldset>
          </div>
        </div>

        <aside class="p-4 border border-border rounded-lg bg-background flex flex-col sm:p-5">
          <span class="qs-type-compact-label text-muted-foreground">当前配置</span>
          <strong class="text-lg mt-2">
            {{ selectedSize.toUpperCase() }} · {{ demoStates.find(state => state.value === selectedState)?.label }}
          </strong>
          <dl class="text-sm m-0 mt-4 gap-3 grid">
            <div class="flex gap-4 items-center justify-between">
              <dt class="text-muted-foreground">
                最后事件
              </dt>
              <dd class="font-medium m-0 text-end break-all">
                {{ lastEvent }}
              </dd>
            </div>
            <div class="flex gap-4 items-center justify-between">
              <dt class="text-muted-foreground">
                关闭原因
              </dt>
              <dd
                data-testid="generic-modal-close-reason"
                class="font-medium m-0 text-end break-all"
              >
                {{ lastCloseReason }}
              </dd>
            </div>
          </dl>
          <FaButton
            data-testid="generic-modal-trigger"
            class="mt-5 w-full"
            @click="openModal"
          >
            <FaIcon name="i-lucide:panels-top-left" />
            打开通用模态框
          </FaButton>
        </aside>
      </div>
    </div>

    <QsGenericModal
      v-model="visible"
      title="复核应收费用"
      description="QS-202607-0042 · 海运出口委托"
      :size="selectedSize"
      :loading="selectedState === 'loading'"
      :submitting="submitting"
      :error="modalError"
      :before-close="handleBeforeClose"
      @opened="handleOpened"
      @closed="handleClosed"
    >
      <template #header-leading>
        <FaIcon name="i-lucide:receipt-text" class="size-4" />
      </template>

      <template #header-extra>
        <FaTag variant="outline" class="text-amber-700 qs-type-status-tag border-amber-500/30 dark:text-amber-300">
          待复核
        </FaTag>
      </template>

      <template #error-actions>
        <FaButton size="sm" variant="outline" @click="retryContent">
          重新加载
        </FaButton>
      </template>

      <div class="gap-6 grid">
        <section>
          <h3 class="qs-type-compact-title m-0">
            费用摘要
          </h3>
          <dl class="text-sm m-0 mt-3 gap-3 grid sm:grid-cols-2">
            <div class="p-3 border border-border rounded-lg bg-muted/20">
              <dt class="qs-type-meta text-muted-foreground">
                客户
              </dt>
              <dd class="qs-type-body-medium m-0 mt-1">
                千航贸易（上海）有限公司
              </dd>
            </div>
            <div class="p-3 border border-border rounded-lg bg-muted/20">
              <dt class="qs-type-meta text-muted-foreground">
                应收合计
              </dt>
              <dd class="qs-type-data-emphasis m-0 mt-1">
                CNY 28,460.00
              </dd>
            </div>
            <div class="p-3 border border-border rounded-lg bg-muted/20">
              <dt class="qs-type-meta text-muted-foreground">
                账期
              </dt>
              <dd class="qs-type-data m-0 mt-1">
                2026-08-25
              </dd>
            </div>
            <div class="p-3 border border-border rounded-lg bg-muted/20">
              <dt class="qs-type-meta text-muted-foreground">
                负责人
              </dt>
              <dd class="qs-type-body-medium m-0 mt-1">
                林舟 · 华东运营组
              </dd>
            </div>
          </dl>
        </section>

        <section
          v-if="selectedState === 'long-content'"
          data-testid="generic-modal-long-content"
        >
          <div class="p-3 border border-primary/20 rounded-lg bg-primary/5 flex gap-3 items-start">
            <FaIcon name="i-lucide:scroll-text" class="text-primary mt-0.5 shrink-0 size-4" />
            <div class="min-w-0">
              <h3 class="qs-type-compact-title m-0">
                滚动边界演示
              </h3>
              <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                Header 与 Footer 保持固定，仅正文区域滚动。
              </p>
            </div>
          </div>

          <div class="mt-3 gap-2 grid">
            <article
              v-for="item in longContentItems"
              :key="item.code"
              class="p-3 border border-border rounded-lg bg-background flex gap-4 items-center justify-between"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap gap-x-2 gap-y-1 items-baseline">
                  <strong class="qs-type-body-medium">{{ item.name }}</strong>
                  <span class="qs-type-data text-muted-foreground">{{ item.code }}</span>
                </div>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  {{ item.note }}
                </p>
              </div>
              <span class="qs-type-data-emphasis shrink-0">{{ item.amount }}</span>
            </article>
          </div>
        </section>

        <section>
          <h3 class="qs-type-compact-title m-0">
            复核说明
          </h3>
          <p class="qs-type-body-relaxed text-muted-foreground m-0 mt-2">
            正式业务页面可在默认插槽中组合自己的表单、校验和领域组件；模态框不发起保存请求，也不推断操作权限。
          </p>
        </section>

        <section class="pt-5 border-t border-border">
          <div class="flex gap-4 items-center justify-between">
            <div class="min-w-0">
              <label for="generic-modal-guard" class="qs-type-body-medium block">
                模拟未保存内容
              </label>
              <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                开启后按钮、遮罩、Escape 和程序化关闭都会被拒绝。
              </p>
            </div>
            <FaSwitch
              id="generic-modal-guard"
              v-model="guardEnabled"
              data-testid="generic-modal-guard-toggle"
            />
          </div>
        </section>
      </div>

      <template #footer>
        <span class="qs-type-meta text-muted-foreground sm:me-auto">
          Footer 完全由调用方提供
        </span>
        <FaButton
          variant="outline"
          class="w-full sm:w-auto"
          :disabled="submitting"
          @click="visible = false"
        >
          取消
        </FaButton>
        <FaButton
          class="w-full sm:w-auto"
          :loading="submitting"
          @click="simulateSubmit"
        >
          确认并关闭
        </FaButton>
      </template>
    </QsGenericModal>
  </section>
</template>
