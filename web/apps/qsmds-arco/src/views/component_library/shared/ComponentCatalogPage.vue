<script setup lang="ts">
interface CatalogPrinciple {
  description: string
  icon: string
  title: string
}

defineOptions({ name: 'ComponentCatalogPage' })

/**
 * 展示壳只接收静态说明，不读取 API、Store 或示例 fixture。
 * 后续真实组件由分类页面通过 slots 或明确属性接入，避免展示层反向污染正式组件。
 */
withDefaults(defineProps<{
  description: string
  emptyDescription: string
  headline: string
  icon: string
  principles: readonly CatalogPrinciple[]
  routePath: string
  sectionLabel: string
  stageLabel?: string
  summary: string
  title: string
}>(), {
  stageLabel: '骨架就绪',
})

const slots = useSlots()
</script>

<template>
  <div>
    <FaPageHeader :description="description">
      <template #title>
        <div class="flex gap-3 items-center">
          <span class="text-primary border border-primary/20 rounded-lg bg-primary/8 flex-center size-9">
            <FaIcon :name="icon" class="size-5" />
          </span>
          <span>{{ title }}</span>
        </div>
      </template>
      <FaTag variant="secondary">
        内部开发工作台
      </FaTag>
    </FaPageHeader>

    <FaPageMain>
      <div class="gap-8 grid lg-gap-12 lg-grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
        <section class="min-w-0">
          <p class="text-xs text-primary tracking-[0.18em] font-semibold m-0 mb-3">
            {{ sectionLabel }}
          </p>
          <h2 class="qs-type-display-title m-0">
            {{ headline }}
          </h2>
          <p class="qs-type-body-relaxed text-muted-foreground m-0 mt-4 max-w-3xl">
            {{ summary }}
          </p>

          <div class="mt-8 border-t border-border">
            <article
              v-for="principle in principles"
              :key="principle.title"
              class="py-5 border-b border-border gap-3 grid sm-grid-cols-[2.5rem_minmax(0,1fr)]"
            >
              <span class="text-primary border border-border rounded-lg bg-muted/35 flex-center size-10">
                <FaIcon :name="principle.icon" class="size-5" />
              </span>
              <div class="min-w-0">
                <h3 class="qs-type-compact-title m-0 mb-1">
                  {{ principle.title }}
                </h3>
                <p class="qs-type-body-relaxed text-muted-foreground m-0">
                  {{ principle.description }}
                </p>
              </div>
            </article>
          </div>
        </section>

        <aside class="min-w-0">
          <div class="p-5 border border-border rounded-xl bg-muted/20">
            <div class="text-xs text-muted-foreground tracking-widest font-semibold mb-3">
              入口路径
            </div>
            <code class="text-xs text-foreground break-all">{{ routePath }}</code>

            <dl class="text-sm m-0 mt-6 space-y-4">
              <div class="pt-4 border-t border-border flex gap-4 items-center justify-between">
                <dt class="text-muted-foreground">
                  访问范围
                </dt>
                <dd class="font-medium m-0">
                  内部环境
                </dd>
              </div>
              <div class="pt-4 border-t border-border flex gap-4 items-center justify-between">
                <dt class="text-muted-foreground">
                  当前阶段
                </dt>
                <dd class="m-0">
                  <FaTag variant="outline">
                    {{ stageLabel }}
                  </FaTag>
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      <!-- 默认插槽只承载已经具备测试契约的真实组件资产；空分类继续显示统一空状态。 -->
      <section v-if="slots.default" class="mt-8 pt-8 border-t border-border">
        <slot />
      </section>

      <section v-else class="mt-8 pt-8 border-t border-border" aria-labelledby="catalog-empty-title">
        <div class="p-4 border border-border rounded-xl border-dashed bg-muted/10 sm-p-6">
          <FaEmpty
            icon="i-lucide:package-open"
            title="当前分类暂时没有可验收资产"
            :description="emptyDescription"
            class="min-h-48"
          />
          <span id="catalog-empty-title" class="sr-only">当前分类暂时没有可验收资产</span>
        </div>
      </section>
    </FaPageMain>
  </div>
</template>
