<script setup lang="ts">
import type { RegionSelectorChange } from '@/components/business/QsRegionSelector/types'
import QsRegionSelector from '@/components/business/QsRegionSelector/index.vue'
import {
  createRegionSelectorFixtureProvider,
  REGION_SELECTOR_FIXTURE_IDS,
} from '../fixtures/region-selector.fixture'

defineOptions({ name: 'RegionSelectorShowcase' })

const fixtureProvider = createRegionSelectorFixtureProvider()
const retryProvider = createRegionSelectorFixtureProvider({
  failFirstRoot: true,
})

const standardValue = ref<string | null>(null)
const taiwanValue = ref<string | null>(
  REGION_SELECTOR_FIXTURE_IDS.taiwanKaohsiung,
)
const stoppedValue = ref<string | null>(
  REGION_SELECTOR_FIXTURE_IDS.stoppedCity,
)
const readonlyValue = ref<string | null>(
  REGION_SELECTOR_FIXTURE_IDS.taiwanKaohsiung,
)
const disabledValue = ref<string | null>(
  REGION_SELECTOR_FIXTURE_IDS.malaysiaKualaLumpur,
)
const retryValue = ref<string | null>(null)
const lastEvent = ref('等待选择')

function handleStandardChange(change: RegionSelectorChange): void {
  lastEvent.value = change.source === 'clear'
    ? 'clear · value=null'
    : `select · ${change.path.map(node => node.name).join(' / ')}`
}
</script>

<template>
  <section aria-labelledby="region-selector-showcase-title">
    <FaAlert
      icon="i-lucide:flask-conical"
      class="mb-6 border-primary/30 bg-primary/5"
    >
      <p class="font-semibold m-0">
        交互样例，不是正式地区数据
      </p>
      <p class="text-sm text-muted-foreground m-0 mt-1">
        本页只使用少量本地 fixture，不访问正式 API、Store 或登录身份；真实业务数据以数据库为准。
      </p>
    </FaAlert>

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
            逐级展开或搜索城市，观察完整路径、CITY UUID、停用回显和各类交互限制。
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
                支持逐级加载、远程式搜索、清空和原生 required。
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
            name="fixtureRegionId"
            required
            :provider="fixtureProvider"
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
                CITY UUID
              </dt>
              <dd class="qs-type-data-mono m-0 text-end break-all">
                {{ standardValue ?? 'null' }}
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
            中国台湾 / 台湾 / 高雄市
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            固定关键路径，外部 CITY UUID 挂载时只解析这一条三级路径。
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
            :provider="fixtureProvider"
          />
        </article>

        <article class="p-4 border border-border rounded-lg bg-background sm:p-5">
          <h4 class="qs-type-compact-title m-0">
            已停用历史路径
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            保留原 UUID 和完整路径供旧记录回显，但停用城市不能再次选中。
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
            :provider="fixtureProvider"
          />
        </article>

        <article class="p-4 border border-border rounded-lg bg-background sm:p-5">
          <h4 class="qs-type-compact-title m-0">
            readonly
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            保持真实输入可聚焦和路径可读，固定关闭弹层、搜索和清空。
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
            :provider="fixtureProvider"
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
            :provider="fixtureProvider"
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
              首次打开时 fixture 仅让根节点请求失败一次；点击组件内“重试加载”即可恢复。
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
