<script setup lang="ts">
import type {
  QsGenericDrawerCloseReason,
  QsGenericDrawerPlacement,
  QsGenericDrawerSize,
} from '@/components/business/QsGenericDrawer/logic'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'

defineOptions({ name: 'GenericDrawerShowcase' })

type DemoState = 'ready' | 'loading' | 'error'

const drawerSizes = ['sm', 'md', 'lg', 'xl'] as const
const drawerPlacements = ['right', 'bottom'] as const
const demoStates: Array<{
  description: string
  icon: string
  label: string
  value: DemoState
}> = [
  {
    description: '完整标题、正文与 Footer',
    icon: 'i-lucide:layout-panel-right',
    label: '标准内容',
    value: 'ready',
  },
  {
    description: '稳定骨架，不遮挡整个页面',
    icon: 'i-lucide:loader-circle',
    label: '加载状态',
    value: 'loading',
  },
  {
    description: '正文内联错误与重试入口',
    icon: 'i-lucide:circle-alert',
    label: '错误状态',
    value: 'error',
  },
]

const visible = ref(false)
const selectedSize = ref<QsGenericDrawerSize>('md')
const selectedPlacement = ref<QsGenericDrawerPlacement>('right')
const selectedState = ref<DemoState>('ready')
const submitting = ref(false)
const guardEnabled = ref(false)
const lastEvent = ref('等待打开')
const lastCloseReason = ref('尚未触发')

const drawerError = computed(() => selectedState.value === 'error'
  ? '暂时无法读取承运信息，请检查网络后重试。'
  : null)

function openDrawer() {
  visible.value = true
  lastEvent.value = `open · ${selectedPlacement.value} / ${selectedSize.value}`
}

function selectState(state: DemoState) {
  selectedState.value = state
}

function selectSize(size: QsGenericDrawerSize) {
  selectedSize.value = size
}

function selectPlacement(placement: QsGenericDrawerPlacement) {
  selectedPlacement.value = placement
}

function handleBeforeClose(reason: QsGenericDrawerCloseReason) {
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
  <section aria-labelledby="generic-drawer-title">
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:panel-right-open" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">业务任务容器</span>
          </div>
          <h3 id="generic-drawer-title" class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl">
            业务通用抽屉
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            选择尺寸、方向和内容状态后打开抽屉。所有数据与异步行为都来自本地确定性示例。
          </p>
        </div>
        <FaTag variant="secondary">
          QsGenericDrawer
        </FaTag>
      </div>

      <div class="mt-6 gap-5 grid lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)]">
        <div class="p-4 border border-border rounded-lg bg-muted/20 sm:p-5">
          <div class="gap-5 grid">
            <fieldset class="m-0 p-0 border-0">
              <legend class="qs-type-compact-label mb-2">
                内容状态
              </legend>
              <div class="gap-2 grid sm:grid-cols-3">
                <button
                  v-for="state in demoStates"
                  :key="state.value"
                  type="button"
                  class="p-3 text-start border rounded-lg bg-background transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  :class="selectedState === state.value
                    ? 'border-primary ring-1 ring-primary/20'
                    : 'border-border hover:border-primary/40'"
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

            <div class="gap-4 grid sm:grid-cols-2">
              <fieldset class="m-0 p-0 border-0">
                <legend class="qs-type-compact-label mb-2">
                  尺寸
                </legend>
                <div class="p-1 border border-border rounded-lg bg-background flex gap-1">
                  <button
                    v-for="size in drawerSizes"
                    :key="size"
                    type="button"
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

              <fieldset class="m-0 p-0 border-0">
                <legend class="qs-type-compact-label mb-2">
                  方向
                </legend>
                <div class="p-1 border border-border rounded-lg bg-background flex gap-1">
                  <button
                    v-for="placement in drawerPlacements"
                    :key="placement"
                    type="button"
                    class="text-xs rounded-md flex-1 h-8 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    :class="selectedPlacement === placement
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
                    :aria-pressed="selectedPlacement === placement"
                    @click="selectPlacement(placement)"
                  >
                    {{ placement === 'right' ? '右侧' : '底部' }}
                  </button>
                </div>
              </fieldset>
            </div>
          </div>
        </div>

        <aside class="p-4 border border-border rounded-lg bg-background flex flex-col sm:p-5">
          <span class="qs-type-compact-label text-muted-foreground">当前配置</span>
          <strong class="text-lg mt-2">
            {{ selectedPlacement === 'right' ? '右侧' : '底部' }} · {{ selectedSize.toUpperCase() }}
          </strong>
          <dl class="text-sm m-0 mt-4 gap-3 grid">
            <div class="flex gap-4 items-center justify-between">
              <dt class="text-muted-foreground">
                状态
              </dt>
              <dd class="font-medium m-0">
                {{ demoStates.find(state => state.value === selectedState)?.label }}
              </dd>
            </div>
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
                data-testid="generic-drawer-close-reason"
                class="font-medium m-0 text-end break-all"
              >
                {{ lastCloseReason }}
              </dd>
            </div>
          </dl>
          <FaButton
            data-testid="generic-drawer-trigger"
            class="mt-5 w-full"
            @click="openDrawer"
          >
            <FaIcon name="i-lucide:panel-right-open" />
            打开通用抽屉
          </FaButton>
        </aside>
      </div>
    </div>

    <QsGenericDrawer
      v-model="visible"
      title="复核运输委托"
      description="QS-202607-0042 · 上海 → 吉隆坡"
      :size="selectedSize"
      :placement="selectedPlacement"
      :loading="selectedState === 'loading'"
      :submitting="submitting"
      :error="drawerError"
      :before-close="handleBeforeClose"
      @opened="handleOpened"
      @closed="handleClosed"
    >
      <template #header-leading>
        <FaIcon name="i-lucide:clipboard-check" class="size-4" />
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
            委托摘要
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
                预计箱量
              </dt>
              <dd class="qs-type-data-emphasis m-0 mt-1">
                12 × 40HQ
              </dd>
            </div>
            <div class="p-3 border border-border rounded-lg bg-muted/20">
              <dt class="qs-type-meta text-muted-foreground">
                计划离港
              </dt>
              <dd class="qs-type-data m-0 mt-1">
                2026-07-28 14:30
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

        <section>
          <h3 class="qs-type-compact-title m-0">
            复核说明
          </h3>
          <p class="qs-type-body-relaxed text-muted-foreground m-0 mt-2">
            当前示例只演示内容滚动与视觉层级。正式页面应在默认插槽中组合自己的表单、校验和领域组件。
          </p>
          <div class="mt-3 p-3 border border-primary/20 rounded-lg bg-primary/5 flex gap-3 items-start">
            <FaIcon name="i-lucide:info" class="text-primary mt-0.5 shrink-0 size-4" />
            <p class="qs-type-description m-0">
              抽屉不会发起保存请求，也不会推断当前用户是否拥有复核权限。
            </p>
          </div>
        </section>

        <section class="pt-5 border-t border-border">
          <div class="flex gap-4 items-center justify-between">
            <div class="min-w-0">
              <label for="generic-drawer-guard" class="qs-type-body-medium block">
                模拟未保存内容
              </label>
              <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                开启后所有关闭请求都会被守卫拒绝。
              </p>
            </div>
            <FaSwitch
              id="generic-drawer-guard"
              v-model="guardEnabled"
              data-testid="generic-drawer-guard-toggle"
            />
          </div>
        </section>
      </div>

      <template #footer>
        <span class="qs-type-meta text-muted-foreground md:me-auto">
          Footer 完全由调用方提供
        </span>
        <FaButton
          variant="outline"
          class="w-full md:w-auto"
          :disabled="submitting"
          @click="visible = false"
        >
          取消
        </FaButton>
        <FaButton
          class="w-full md:w-auto"
          :loading="submitting"
          @click="simulateSubmit"
        >
          保存并关闭
        </FaButton>
      </template>
    </QsGenericDrawer>
  </section>
</template>
