<script setup lang="ts">
import type { QsToastId } from '@/components/base/QsToast/types'
import { useQsToast } from '@/components/base/QsToast/useQsToast'

defineOptions({ name: 'QsToastShowcase' })

const toast = useQsToast()
let loadingId: QsToastId | undefined
let loadingTimer: ReturnType<typeof setTimeout> | undefined
const promiseTimers = new Set<ReturnType<typeof setTimeout>>()

const states = [
  {
    description: '保存、同步等操作完成',
    icon: 'i-lucide:circle-check',
    label: '成功',
    toneClass: 'text-green-700 dark:text-green-400',
  },
  {
    description: '补充系统或流程信息',
    icon: 'i-lucide:info',
    label: '信息',
    toneClass: 'text-blue-700 dark:text-blue-400',
  },
  {
    description: '提醒风险或前置条件',
    icon: 'i-lucide:triangle-alert',
    label: '警告',
    toneClass: 'text-amber-700 dark:text-amber-400',
  },
  {
    description: '操作失败且需要处理',
    icon: 'i-lucide:circle-x',
    label: '错误',
    toneClass: 'text-red-700 dark:text-red-400',
  },
] as const

function showDefaultToast() {
  toast.show('草稿已自动保存', {
    description: '可以继续编辑当前内容。',
  })
}

function showSuccessToast() {
  toast.success('保存成功', {
    description: '内容已同步到服务器。',
  })
}

function showInfoToast() {
  toast.info('系统维护提醒', {
    description: '今晚 22:30 将进行短时维护。',
  })
}

function showWarningToast() {
  toast.warning('仍有内容未填写', {
    description: '提交前请检查必填字段。',
  })
}

function showErrorToast() {
  toast.error('保存失败', {
    description: '网络连接中断，请检查后重试。',
  })
}

function showActionToast() {
  toast.show('文件已移入回收站', {
    action: {
      label: '撤销',
      onClick: () => {
        toast.success('已撤销删除')
      },
    },
    description: '文件将在 30 天后自动清理。',
  })
}

function dismissLoadingToast() {
  if (loadingId !== undefined) {
    toast.dismiss(loadingId)
    loadingId = undefined
  }
  if (loadingTimer !== undefined) {
    clearTimeout(loadingTimer)
    loadingTimer = undefined
  }
}

function showLoadingToast() {
  dismissLoadingToast()
  loadingId = toast.loading('正在生成结算预览', {
    description: '请保持当前页面开启。',
  })
  loadingTimer = setTimeout(() => {
    const activeId = loadingId
    loadingId = undefined
    loadingTimer = undefined
    if (activeId !== undefined) {
      toast.dismiss(activeId)
      toast.success('预览已生成', {
        description: '现在可以检查金额与币种。',
      })
    }
  }, 1800)
}

function showPromiseToast() {
  void toast.promise(
    new Promise<{ version: string }>((resolve) => {
      const timer = setTimeout(() => {
        promiseTimers.delete(timer)
        resolve({ version: 'v2.7' })
      }, 1600)
      promiseTimers.add(timer)
    }),
    {
      loading: {
        title: '正在保存规则',
        description: '系统正在校验最新配置。',
      },
      success: result => ({
        title: '规则已保存',
        description: `已生成配置版本 ${result.version}。`,
      }),
      error: {
        title: '规则保存失败',
        description: '请稍后重试。',
      },
    },
  )
}

onBeforeUnmount(() => {
  dismissLoadingToast()
  // Showcase 的异步任务不得在离开组件库页面后继续产生全局反馈。
  promiseTimers.forEach(timer => clearTimeout(timer))
  promiseTimers.clear()
  toast.dismiss()
})
</script>

<template>
  <section aria-labelledby="qs-toast-showcase-title">
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:message-circle-more" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">反馈工作台</span>
          </div>
          <h3 id="qs-toast-showcase-title" class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl">
            在真实队列中检查每种提示
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-2xl">
            点击下方按钮会调用全局唯一的 FaToast Host。示例只使用本地定时器，不请求业务 API，也不读取 Store。
          </p>
        </div>
        <FaTag variant="secondary">
          QsToast
        </FaTag>
      </div>

      <div class="mt-7 gap-8 grid lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.65fr)]">
        <div class="min-w-0">
          <div class="pb-4 border-b border-border">
            <h4 class="text-base font-semibold m-0">
              状态提示
            </h4>
            <p class="text-xs text-muted-foreground m-0 mt-1">
              状态颜色只承担识别，不改变整块浮层表面。
            </p>
          </div>

          <div class="border-b border-border divide-border divide-y">
            <article
              v-for="state in states"
              :key="state.label"
              class="py-4 gap-4 grid items-center sm:grid-cols-[2rem_minmax(0,1fr)_auto]"
            >
              <FaIcon :name="state.icon" class="size-5" :class="state.toneClass" />
              <div class="min-w-0">
                <p class="text-sm font-semibold m-0">
                  {{ state.label }}
                </p>
                <p class="text-xs text-muted-foreground m-0 mt-0.5">
                  {{ state.description }}
                </p>
              </div>
              <FaButton
                variant="outline"
                size="sm"
                :aria-label="`触发${state.label}提示`"
                @click="state.label === '成功'
                  ? showSuccessToast()
                  : state.label === '信息'
                    ? showInfoToast()
                    : state.label === '警告'
                      ? showWarningToast()
                      : showErrorToast()"
              >
                触发
              </FaButton>
            </article>
          </div>

          <div class="pt-6 flex flex-wrap gap-3">
            <FaButton variant="secondary" @click="showDefaultToast">
              普通提示
            </FaButton>
            <FaButton variant="secondary" @click="showActionToast">
              带撤销操作
            </FaButton>
          </div>
        </div>

        <aside class="p-5 border border-border rounded-xl bg-muted/20 self-start">
          <p class="text-xs text-primary tracking-[0.16em] font-semibold m-0">
            异步反馈
          </p>
          <h4 class="text-base font-semibold m-0 mt-3">
            Loading 与 Promise
          </h4>
          <p class="text-xs text-muted-foreground leading-5 m-0 mt-2">
            永久 loading 提供关闭入口；异步完成后先关闭 loading，再创建具有正常时长的结果提示。
          </p>

          <div class="mt-5 pt-5 border-t border-border space-y-3">
            <FaButton class="w-full" @click="showLoadingToast">
              演示加载到成功
            </FaButton>
            <FaButton class="w-full" variant="outline" @click="showPromiseToast">
              演示 Promise
            </FaButton>
            <FaButton class="w-full" variant="ghost" @click="dismissLoadingToast">
              关闭当前加载
            </FaButton>
          </div>

          <dl class="text-xs m-0 mt-6 pt-5 border-t border-border space-y-3">
            <div class="flex gap-3 items-center justify-between">
              <dt class="text-muted-foreground">
                默认位置
              </dt>
              <dd class="font-medium m-0">
                top-center
              </dd>
            </div>
            <div class="flex gap-3 items-center justify-between">
              <dt class="text-muted-foreground">
                移动端间距
              </dt>
              <dd class="font-medium m-0">
                16px
              </dd>
            </div>
            <div class="flex gap-3 items-center justify-between">
              <dt class="text-muted-foreground">
                Reduced Motion
              </dt>
              <dd class="font-medium m-0">
                支持
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  </section>
</template>
