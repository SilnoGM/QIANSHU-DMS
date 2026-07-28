<script setup lang="ts">
import type {
  RegionSelectorChange,
  RegionSelectorValue,
} from '@/components/business/QsRegionSelector/types'
import QsRegionSelector from '@/components/business/QsRegionSelector/index.vue'
import {
  createRegionSelectorFixtureProvider,
  REGION_SELECTOR_FIXTURE_IDS,
} from '../fixtures/region-selector.fixture'

defineOptions({ name: 'RegionSelectorShowcase' })

const EMPTY_REGION_VALUE = Object.freeze({
  cityId: null,
  countryRegionId: null,
  provinceStateId: null,
}) satisfies RegionSelectorValue
const TAIWAN_KAOHSIUNG_VALUE = Object.freeze({
  cityId: '78f9134e-3d72-5f6e-9897-ca7e50004229',
  countryRegionId: '2e30acdf-7559-5fc2-8e00-c5b069d3df8b',
  provinceStateId: 'ee82c572-f653-51d2-98d4-f11ac5928aa1',
}) satisfies RegionSelectorValue
const MALAYSIA_KUALA_LUMPUR_VALUE = Object.freeze({
  cityId: '5bb627db-828b-5dc3-8c42-ef2fdbbb2bb6',
  countryRegionId: '856ded05-d4d3-5a84-b8f2-a2d8ce5ca562',
  provinceStateId: '3f3457fc-a2b0-5858-b904-3cc126b7bf8e',
}) satisfies RegionSelectorValue
const STOPPED_REGION_VALUE = Object.freeze({
  cityId: REGION_SELECTOR_FIXTURE_IDS.stoppedCity,
  countryRegionId: '90f34764-3527-58d8-9c15-9e8586ea6f28',
  provinceStateId: '4bdb6632-7f57-5eb4-84cf-ba733771dbaf',
}) satisfies RegionSelectorValue

// 只有数据库无法稳定制造的停用、失败边界才使用隔离 fixture。
const stoppedProvider = createRegionSelectorFixtureProvider()
const retryProvider = createRegionSelectorFixtureProvider({
  failFirstRoot: true,
})

const standardValue = ref<RegionSelectorValue>({ ...EMPTY_REGION_VALUE })
const taiwanValue = ref<RegionSelectorValue>({ ...TAIWAN_KAOHSIUNG_VALUE })
const stoppedValue = ref<RegionSelectorValue>({ ...STOPPED_REGION_VALUE })
const readonlyValue = ref<RegionSelectorValue>({ ...TAIWAN_KAOHSIUNG_VALUE })
const disabledValue = ref<RegionSelectorValue>({
  ...MALAYSIA_KUALA_LUMPUR_VALUE,
})
const retryValue = ref<RegionSelectorValue>({ ...EMPTY_REGION_VALUE })
const lastEvent = ref('等待选择')

function handleStandardChange(change: RegionSelectorChange): void {
  lastEvent.value = change.source === 'clear'
    ? 'clear · complete=false'
    : `${change.source} · ${change.path.map(node => node.name).join(' ')} · complete=${change.complete}`
}
</script>

<template>
  <section aria-labelledby="region-selector-showcase-title">
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:map-pinned" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">三级地区字段</span>
          </div>
          <h3
            id="region-selector-showcase-title"
            class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl"
          >
            地区选择交互状态
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            标准状态直接读取数据库；三个字段逐级加载，观察结构化 UUID、完整路径和各类交互限制。
          </p>
        </div>
        <FaTag variant="secondary">
          QsRegionSelector
        </FaTag>
      </div>

      <p
        class="text-sm text-muted-foreground mb-0 mt-5 sm:hidden"
        role="status"
      >
        当前为窄屏验收状态：选择器保持全宽，弹层仅在内部滚动，触控目标不小于 44px。
      </p>

      <div class="mt-6 gap-5 grid lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <form
          class="p-4 border border-border rounded-lg bg-muted/20 sm:p-5"
          @submit.prevent
        >
          <div class="flex gap-2 items-center justify-between">
            <div>
              <h4 class="qs-type-compact-title m-0">
                标准选择
              </h4>
              <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                通过正式地区 API 按级加载，支持依赖重置、清空和原生 required。
              </p>
            </div>
            <FaTag variant="outline">
              可交互
            </FaTag>
          </div>
          <label
            for="region-selector-showcase-standard"
            class="qs-type-compact-label mb-2 mt-5 block"
          >
            业务所在城市
          </label>
          <QsRegionSelector
            id="region-selector-showcase-standard"
            v-model="standardValue"
            data-testid="region-selector-showcase-standard"
            name="regionCityId"
            required
            @change="handleStandardChange"
          />
        </form>

        <aside class="p-4 border border-border rounded-lg bg-background sm:p-5">
          <span class="qs-type-compact-label text-muted-foreground">
            当前受控结果
          </span>
          <dl class="text-sm m-0 mt-4 gap-3 grid">
            <div class="flex gap-4 items-start justify-between">
              <dt class="text-muted-foreground">
                国家/地区 UUID
              </dt>
              <dd class="qs-type-data-mono m-0 text-end break-all">
                {{ standardValue.countryRegionId ?? 'null' }}
              </dd>
            </div>
            <div class="pt-3 border-t border-border flex gap-4 items-start justify-between">
              <dt class="text-muted-foreground">
                省/州 UUID
              </dt>
              <dd class="qs-type-data-mono m-0 text-end break-all">
                {{ standardValue.provinceStateId ?? 'null' }}
              </dd>
            </div>
            <div class="pt-3 border-t border-border flex gap-4 items-start justify-between">
              <dt class="text-muted-foreground">
                城市 UUID
              </dt>
              <dd class="qs-type-data-mono m-0 text-end break-all">
                {{ standardValue.cityId ?? 'null' }}
              </dd>
            </div>
            <div class="pt-3 border-t border-border flex gap-4 items-start justify-between">
              <dt class="text-muted-foreground">
                change
              </dt>
              <dd class="font-medium m-0 text-end break-all">
                {{ lastEvent }}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <div class="mt-5 gap-4 grid md:grid-cols-2">
        <article class="p-4 border border-border rounded-lg bg-background sm:p-5">
          <h4 class="qs-type-compact-title m-0">
            中国台湾 台湾 高雄市
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            固定关键路径，外部结构化值挂载时校验并解析这一条三级路径。
          </p>
          <label
            for="region-selector-showcase-taiwan"
            class="qs-type-compact-label mb-2 mt-4 block"
          >
            台湾地区路径
          </label>
          <QsRegionSelector
            id="region-selector-showcase-taiwan"
            v-model="taiwanValue"
          />
        </article>

        <article class="p-4 border border-border rounded-lg bg-background sm:p-5">
          <h4 class="qs-type-compact-title m-0">
            已停用历史路径
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            隔离 fixture 保留原 UUID 和完整路径供旧记录回显，但停用城市不能再次选中。
          </p>
          <label
            for="region-selector-showcase-stopped"
            class="qs-type-compact-label mb-2 mt-4 block"
          >
            历史记录地区
          </label>
          <QsRegionSelector
            id="region-selector-showcase-stopped"
            v-model="stoppedValue"
            :provider="stoppedProvider"
          />
        </article>

        <article class="p-4 border border-border rounded-lg bg-background sm:p-5">
          <h4 class="qs-type-compact-title m-0">
            readonly
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            保持路径可聚焦和可读，固定关闭三个下拉与清空。
          </p>
          <label
            for="region-selector-showcase-readonly"
            class="qs-type-compact-label mb-2 mt-4 block"
          >
            只读地区
          </label>
          <QsRegionSelector
            id="region-selector-showcase-readonly"
            v-model="readonlyValue"
            readonly
          />
        </article>

        <article class="p-4 border border-border rounded-lg bg-background sm:p-5">
          <h4 class="qs-type-compact-title m-0">
            disabled
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            阻止所有用户交互，非空 value 仍会解析并显示完整三级路径。
          </p>
          <label
            for="region-selector-showcase-disabled"
            class="qs-type-compact-label mb-2 mt-4 block"
          >
            禁用地区
          </label>
          <QsRegionSelector
            id="region-selector-showcase-disabled"
            v-model="disabledValue"
            disabled
          />
        </article>
      </div>

      <article class="mt-5 p-4 border border-border rounded-lg bg-muted/20 sm:p-5">
        <div class="gap-4 grid md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)] md:items-end">
          <div>
            <h4 class="qs-type-compact-title m-0">
              一次失败后可重试
            </h4>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              首次挂载时 fixture 仅让根节点请求失败一次；点击组件内“重试加载”即可恢复。
            </p>
          </div>
          <div>
            <label
              for="region-selector-showcase-retry"
              class="qs-type-compact-label mb-2 block"
            >
              失败与重试
            </label>
            <QsRegionSelector
              id="region-selector-showcase-retry"
              v-model="retryValue"
              :provider="retryProvider"
            />
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
