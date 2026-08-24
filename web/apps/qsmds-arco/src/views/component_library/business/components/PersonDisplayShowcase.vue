<script setup lang="ts">
import avatarUrl from '@/assets/images/logo.svg'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
</script>

<template>
  <section
    aria-labelledby="person-display-showcase-title"
    data-testid="person-display-showcase"
  >
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:user-round" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">人员标识</span>
          </div>
          <h3
            id="person-display-showcase-title"
            class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl"
          >
            头像可用与降级状态
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            示例覆盖本地图片、无头像、损坏图片、未知人员与超长名称，不读取真实人员数据。
          </p>
        </div>
        <FaTag variant="secondary">
          QsPersonDisplay
        </FaTag>
      </div>

      <div class="mt-6 border-y border-border divide-border divide-y">
        <div class="py-5 gap-4 grid sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
          <span class="qs-type-meta text-muted-foreground">正常头像</span>
          <QsPersonDisplay
            display-name="林雅婷"
            :avatar-url="avatarUrl"
          />
        </div>
        <div class="py-5 gap-4 grid sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
          <span class="qs-type-meta text-muted-foreground">无头像回退</span>
          <QsPersonDisplay display-name="陈志明" />
        </div>
        <div class="py-5 gap-4 grid sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
          <span class="qs-type-meta text-muted-foreground">损坏图片回退</span>
          <QsPersonDisplay
            display-name="周婉君"
            avatar-url="/component-library/missing-person-avatar.png"
          />
        </div>
        <div class="py-5 gap-4 grid sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
          <span class="qs-type-meta text-muted-foreground">未知人员</span>
          <QsPersonDisplay display-name="" />
        </div>
        <div class="py-5 gap-4 grid sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
          <span class="qs-type-meta text-muted-foreground">受限宽度</span>
          <QsPersonDisplay
            display-name="东南亚区域销售与履约协同负责人"
            class="max-w-52"
          />
        </div>
      </div>

      <div class="mt-7">
        <p class="qs-type-compact-label text-foreground m-0">
          三档尺寸
        </p>
        <div class="mt-4 flex flex-wrap gap-x-8 gap-y-5 items-center">
          <QsPersonDisplay display-name="小尺寸 · 表格" size="sm" />
          <QsPersonDisplay display-name="中尺寸 · 默认" size="md" />
          <QsPersonDisplay display-name="大尺寸 · 详情" size="lg" />
        </div>
      </div>
    </div>
  </section>
</template>
