<script setup lang="ts">
import productFront from '@/assets/images/component-library/image-group/product-front.svg'
import productSide from '@/assets/images/component-library/image-group/product-side.svg'
import QsGoodTooltip from '@/components/business/QsGoodTooltip/index.vue'

defineOptions({ name: 'GoodTooltipShowcase' })

const brokenImageSrc = '/component-library/good-tooltip/missing-product-image.png'
</script>

<template>
  <section aria-labelledby="good-tooltip-showcase-title">
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:package-search" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">只读业务提示</span>
          </div>
          <h3 id="good-tooltip-showcase-title" class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl">
            一种框架，承载不同产品信息
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-2xl">
            聚焦或 hover 产品触发器查看示例。产品字段与右侧样式来自调用方，组件只管理图片、边界和 Tooltip 内核。
          </p>
        </div>
        <FaTag variant="secondary">
          QsGoodTooltip
        </FaTag>
      </div>

      <div class="mt-7 gap-8 grid lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
        <div class="min-w-0">
          <div class="pb-4 border-b border-border">
            <h4 class="text-base font-semibold m-0">
              SPU 与 SKU
            </h4>
            <p class="text-xs text-muted-foreground m-0 mt-1">
              同一个 content 插槽根据业务上下文选择字段、层级和排版。
            </p>
          </div>

          <div class="border-b border-border divide-border divide-y">
            <div class="py-5 gap-4 grid items-center sm:grid-cols-[8rem_minmax(0,1fr)]">
              <div>
                <p class="text-sm font-medium m-0">
                  正常产品图
                </p>
                <p class="text-xs text-muted-foreground m-0 mt-1">
                  SPU 信息
                </p>
              </div>

              <QsGoodTooltip
                :image-src="productFront"
                image-alt="墨蓝色城市旅行收纳包"
                side="right"
              >
                <button
                  type="button"
                  class="p-2 text-left border border-border rounded-lg bg-background flex gap-3 max-w-sm w-full transition-colors items-center focus-visible:outline-none hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-primary/40"
                  aria-label="查看城市旅行收纳包 SPU 信息"
                >
                  <img :src="productFront" alt="" class="rounded-md shrink-0 size-12 object-cover">
                  <span class="min-w-0">
                    <span class="text-sm font-semibold block truncate">城市旅行收纳包</span>
                    <span class="text-xs text-muted-foreground font-mono mt-1 block">SPU-BAG-202607-014</span>
                  </span>
                </button>

                <template #content>
                  <div class="min-w-0">
                    <p class="text-sm leading-5 font-semibold m-0">
                      城市旅行收纳包
                    </p>
                    <p class="font-mono m-0 mt-1 opacity-70 break-all">
                      SPU-BAG-202607-014
                    </p>
                    <dl class="m-0 mt-2 pt-2 border-t border-background/15 space-y-1.5">
                      <div class="flex gap-3 items-start justify-between">
                        <dt class="opacity-65">
                          分类
                        </dt>
                        <dd class="m-0 text-right">
                          旅行收纳
                        </dd>
                      </div>
                      <div class="flex gap-3 items-start justify-between">
                        <dt class="opacity-65">
                          状态
                        </dt>
                        <dd class="m-0 text-right">
                          在售
                        </dd>
                      </div>
                    </dl>
                  </div>
                </template>
              </QsGoodTooltip>
            </div>

            <div class="py-5 gap-4 grid items-center sm:grid-cols-[8rem_minmax(0,1fr)]">
              <div>
                <p class="text-sm font-medium m-0">
                  规格产品图
                </p>
                <p class="text-xs text-muted-foreground m-0 mt-1">
                  SKU 信息
                </p>
              </div>

              <QsGoodTooltip
                :image-src="productSide"
                image-alt="墨蓝色中号旅行收纳包侧面"
                image-fit="contain"
                side="right"
              >
                <button
                  type="button"
                  class="p-2 text-left border border-border rounded-lg bg-background flex gap-3 max-w-sm w-full transition-colors items-center focus-visible:outline-none hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-primary/40"
                  aria-label="查看旅行收纳包 SKU 信息"
                >
                  <img :src="productSide" alt="" class="rounded-md shrink-0 size-12 object-contain">
                  <span class="min-w-0">
                    <span class="text-sm font-semibold block truncate">墨蓝 / 中号</span>
                    <span class="text-xs text-muted-foreground font-mono mt-1 block">SKU-BAG-NV-M-041</span>
                  </span>
                </button>

                <template #content>
                  <div class="min-w-0">
                    <p class="text-sm leading-5 font-semibold m-0">
                      城市旅行收纳包
                    </p>
                    <p class="font-mono m-0 mt-1 opacity-70 break-all">
                      SKU-BAG-NV-M-041
                    </p>
                    <div class="m-0 mt-2 pt-2 border-t border-background/15">
                      <p class="m-0">
                        墨蓝 / 中号 / 防泼水
                      </p>
                      <p class="m-0 mt-1 opacity-65">
                        当前规格可售
                      </p>
                    </div>
                  </div>
                </template>
              </QsGoodTooltip>
            </div>
          </div>
        </div>

        <aside class="p-5 border border-border rounded-xl bg-muted/20 self-start">
          <p class="text-xs text-primary tracking-[0.16em] font-semibold m-0">
            公共边界
          </p>
          <dl class="text-sm m-0 mt-5 space-y-4">
            <div class="pb-4 border-b border-border">
              <dt class="text-muted-foreground">
                触发器
              </dt>
              <dd class="font-medium m-0 mt-1">
                单个可聚焦根节点
              </dd>
            </div>
            <div class="pb-4 border-b border-border">
              <dt class="text-muted-foreground">
                信息区域
              </dt>
              <dd class="font-medium m-0 mt-1">
                只读 content 插槽
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">
                数据来源
              </dt>
              <dd class="font-medium m-0 mt-1">
                完全由调用方提供
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <div class="mt-8 pt-7 border-t border-border">
        <div class="flex flex-wrap gap-3 items-end justify-between">
          <div>
            <h4 class="text-base font-semibold m-0">
              图片与启用边界
            </h4>
            <p class="text-xs text-muted-foreground m-0 mt-1">
              空值、加载失败和禁用状态不会改变触发器本身。
            </p>
          </div>
          <span class="text-xs text-muted-foreground">失败状态在图片地址变化后自动清除</span>
        </div>

        <div class="mt-4 border-y border-border divide-border divide-y">
          <div class="py-4 flex flex-wrap gap-4 items-center justify-between">
            <span class="text-sm font-medium">无产品图</span>
            <QsGoodTooltip :image-src="null">
              <button type="button" class="text-sm px-3 py-2 border border-border rounded-lg bg-background hover:bg-muted/45">
                查看无图产品
              </button>
              <template #content>
                <p class="text-sm font-semibold m-0">
                  暂未上传主图
                </p>
              </template>
            </QsGoodTooltip>
          </div>
          <div class="py-4 flex flex-wrap gap-4 items-center justify-between">
            <span class="text-sm font-medium">图片失败</span>
            <QsGoodTooltip :image-src="brokenImageSrc" image-alt="无法加载的产品图片">
              <button type="button" class="text-sm px-3 py-2 border border-border rounded-lg bg-background hover:bg-muted/45">
                查看失效图片
              </button>
              <template #content>
                <p class="text-sm font-semibold m-0">
                  图片加载失败
                </p>
              </template>
            </QsGoodTooltip>
          </div>
          <div class="py-4 flex flex-wrap gap-4 items-center justify-between">
            <span class="text-sm font-medium">禁用状态</span>
            <QsGoodTooltip :image-src="productFront" disabled>
              <button type="button" class="text-sm px-3 py-2 border border-border rounded-lg bg-muted/30 cursor-default">
                产品提示已禁用
              </button>
              <template #content>
                <span>禁用状态不应显示</span>
              </template>
            </QsGoodTooltip>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
