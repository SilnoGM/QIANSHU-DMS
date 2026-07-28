<script setup lang="ts">
import type { RegionSelectorChange } from '@/components/business/QsRegionSelector/types'

import { useRoute } from 'vue-router'
import QsRegionSelector from '@/components/business/QsRegionSelector/index.vue'

defineOptions({ name: 'RegionSelectorBrowserHarness' })

const TAIWAN_KAOHSIUNG_CITY_ID = '78f9134e-3d72-5f6e-9897-ca7e50004229'
const UUID_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

const route = useRoute()
const primaryValue = ref<string | null>(null)
const secondaryValue = ref<string | null>(null)
const readonlyValue = ref<string | null>(TAIWAN_KAOHSIUNG_CITY_ID)
const disabledValue = ref<string | null>(TAIWAN_KAOHSIUNG_CITY_ID)
const submittedValue = ref('未提交')
const lastChange = ref('等待选择')

const scenario = computed(() => {
  const value = Array.isArray(route.query.case)
    ? route.query.case[0]
    : route.query.case
  return typeof value === 'string' && value.length > 0 ? value : 'standard'
})

const requestedCityId = computed(() => {
  const value = Array.isArray(route.query.value)
    ? route.query.value[0]
    : route.query.value
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? value
    : TAIWAN_KAOHSIUNG_CITY_ID
})

/**
 * 每个 Browser 场景通过完整路由导航获得冷启动组件。只有 path/states 需要预置
 * CITY UUID；其余场景从 null 开始，便于分别观察 root、lazy 与 search 请求。
 */
watch(
  [scenario, requestedCityId],
  ([currentScenario, cityId]) => {
    primaryValue.value = currentScenario === 'path' ? cityId : null
    secondaryValue.value = null
    readonlyValue.value = cityId
    disabledValue.value = cityId
    submittedValue.value = '未提交'
    lastChange.value = '等待选择'
  },
  { immediate: true },
)

function handleChange(change: RegionSelectorChange): void {
  lastChange.value = change.source === 'clear'
    ? 'clear · value=null'
    : `select · ${change.path.map(node => node.name).join(' / ')}`
}

function handleSubmit(event: Event): void {
  const form = event.currentTarget
  if (!(form instanceof HTMLFormElement)) {
    submittedValue.value = 'invalid-form'
    return
  }
  const value = new FormData(form).get('regionCityId')
  submittedValue.value = typeof value === 'string' && value.length > 0
    ? value
    : 'null'
}
</script>

<template>
  <div
    data-testid="region-selector-browser-harness"
    :data-e2e-case="scenario"
  >
    <FaPageHeader
      title="地区选择器 Browser E2E"
      description="仅在隔离 test build 注册；所有选择器均使用应用启动层提供的正式地区 Provider。"
    />

    <FaPageMain>
      <div
        v-if="scenario !== 'provider-only'"
        class="gap-5 grid min-w-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]"
      >
        <form
          data-testid="region-selector-live-form"
          class="p-4 border border-border rounded-lg min-w-0 sm:p-5"
          @submit.prevent="handleSubmit"
        >
          <h1 class="qs-type-compact-title m-0">
            默认 Provider 三级选择
          </h1>
          <p
            id="region-selector-e2e-help"
            class="qs-type-meta text-muted-foreground mb-0 mt-1"
          >
            真实 HTTP、缓存、错误重试与表单语义验收入口。
          </p>

          <label
            for="region-selector-e2e-primary"
            class="qs-type-compact-label mb-2 mt-5 block"
          >
            业务所在城市
          </label>
          <QsRegionSelector
            id="region-selector-e2e-primary"
            :key="`primary-${scenario}-${requestedCityId}`"
            v-model="primaryValue"
            name="regionCityId"
            autocomplete="address-level2"
            aria-describedby="region-selector-e2e-help"
            required
            @change="handleChange"
          />

          <FaButton type="submit" class="mt-4">
            验证 FormData
          </FaButton>
        </form>

        <aside
          class="p-4 border border-border rounded-lg min-w-0 sm:p-5"
          aria-label="地区选择结果"
        >
          <dl class="text-sm m-0 gap-3 grid">
            <div>
              <dt class="qs-type-compact-label text-muted-foreground">
                受控 CITY UUID
              </dt>
              <dd
                data-testid="region-selector-controlled-value"
                class="qs-type-data-mono m-0 mt-1 break-all"
              >
                {{ primaryValue ?? 'null' }}
              </dd>
            </div>
            <div class="pt-3 border-t border-border">
              <dt class="qs-type-compact-label text-muted-foreground">
                FormData
              </dt>
              <dd
                data-testid="region-selector-form-data"
                class="qs-type-data-mono m-0 mt-1 break-all"
              >
                {{ submittedValue }}
              </dd>
            </div>
            <div class="pt-3 border-t border-border">
              <dt class="qs-type-compact-label text-muted-foreground">
                change
              </dt>
              <dd
                data-testid="region-selector-change"
                class="m-0 mt-1 break-words"
              >
                {{ lastChange }}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <section
        v-if="scenario === 'dedupe'"
        class="mt-5 p-4 border border-border rounded-lg min-w-0 sm:p-5"
        aria-labelledby="region-selector-dedupe-title"
      >
        <h2 id="region-selector-dedupe-title" class="qs-type-compact-title m-0">
          同身份并发去重
        </h2>
        <label
          for="region-selector-e2e-secondary"
          class="qs-type-compact-label mb-2 mt-4 block"
        >
          第二个地区选择器
        </label>
        <QsRegionSelector
          id="region-selector-e2e-secondary"
          v-model="secondaryValue"
          aria-describedby="region-selector-dedupe-title"
        />
      </section>

      <section
        v-if="scenario === 'states'"
        class="mt-5 gap-4 grid min-w-0 md:grid-cols-2"
        aria-label="只读与禁用状态"
      >
        <div class="p-4 border border-border rounded-lg min-w-0 sm:p-5">
          <label
            for="region-selector-e2e-readonly"
            class="qs-type-compact-label mb-2 block"
          >
            只读地区
          </label>
          <QsRegionSelector
            id="region-selector-e2e-readonly"
            v-model="readonlyValue"
            readonly
          />
        </div>
        <div class="p-4 border border-border rounded-lg min-w-0 sm:p-5">
          <label
            for="region-selector-e2e-disabled"
            class="qs-type-compact-label mb-2 block"
          >
            禁用地区
          </label>
          <QsRegionSelector
            id="region-selector-e2e-disabled"
            v-model="disabledValue"
            disabled
          />
        </div>
      </section>
    </FaPageMain>
  </div>
</template>
