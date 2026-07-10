<script setup lang="ts">
import Sortable from 'sortablejs'

const boardData = ref([
  {
    id: 1,
    name: '待办事项 Backlog',
    tasks: [
      {
        id: 1,
        title: '设计新用户界面',
        description: '为移动端应用设计全新的用户界面，提升用户体验',
        avatars: [
          'designer1',
          'designer2',
          'ui-specialist',
        ],
        progress: 0,
      },
      {
        id: 2,
        title: '完善用户认证系统',
        description: '增强用户登录安全性，添加双因素认证功能',
        avatars: [
          'backend-dev',
          'security-expert',
        ],
        progress: 0,
      },
      {
        id: 3,
        title: '数据库性能优化',
        description: '优化查询语句，提高大数据量下的响应速度',
        avatars: [
          'db-admin',
        ],
        progress: 0,
      },
    ],
  },
  {
    id: 2,
    name: '进行中 In Progress',
    tasks: [
      {
        id: 4,
        title: 'API接口开发',
        description: '实现RESTful API供前端调用，包括用户管理和订单处理',
        avatars: [
          'backend-dev1',
          'backend-dev2',
        ],
        progress: 65,
      },
      {
        id: 5,
        title: '移动端适配',
        description: '确保网页在各种移动设备上的显示效果一致',
        avatars: [
          'frontend-dev',
        ],
        progress: 40,
      },
      {
        id: 6,
        title: '编写单元测试',
        description: '为关键业务逻辑编写全面的单元测试用例',
        avatars: [
          'qa-engineer',
          'tester',
        ],
        progress: 75,
      },
    ],
  },
  {
    id: 3,
    name: '已完成 Done',
    tasks: [
      {
        id: 7,
        title: '项目初始化',
        description: '搭建项目基础架构，配置开发环境',
        avatars: [
          'project-manager',
          'lead-dev',
        ],
        progress: 100,
      },
      {
        id: 8,
        title: '需求分析文档',
        description: '完成产品需求规格说明书的撰写和评审',
        avatars: [
          'product-manager',
          'business-analyst',
        ],
        progress: 100,
      },
      {
        id: 9,
        title: '技术选型调研',
        description: '评估并确定前后端技术栈及第三方服务',
        avatars: [
          'architect',
          'tech-lead',
        ],
        progress: 100,
      },
    ],
  },
])

const boardContainerRef = useTemplateRef('boardContainerRef')
const taskContainerRef = useTemplateRef('taskContainerRef')

// 存储任务容器对应的 Sortable 实例
const taskSortableMap = new Map<HTMLElement, Sortable>()

// 初始化任务拖拽功能
function initTaskSortable() {
  nextTick(() => {
    if (taskContainerRef.value) {
      taskContainerRef.value.forEach((container) => {
        // 检查是否已经初始化过
        if (!taskSortableMap.has(container)) {
          const sortable = new Sortable(container, {
            group: 'task',
            animation: 200,
            ghostClass: 'opacity-50',
            draggable: '.task',
            dragClass: 'opacity-0',
            onEnd: (e) => {
              const { oldIndex, newIndex, from, to, item, pullMode } = e
              if (pullMode === true) {
                if (oldIndex === undefined || newIndex === undefined) {
                  return
                }
                const fromBoardIndex = Number.parseInt(from.dataset.boardIndex!)
                const toBoardIndex = Number.parseInt(to.dataset.boardIndex!)
                const movedTask = boardData.value[fromBoardIndex].tasks.splice(oldIndex, 1)[0]
                boardData.value[toBoardIndex].tasks.splice(newIndex, 0, movedTask)
                useFaToast().info(`Task moved from board ${fromBoardIndex},${oldIndex} to board ${toBoardIndex},${newIndex}`)
              }
              else {
                if (oldIndex === undefined || newIndex === undefined) {
                  return
                }
                const boardIndex = Number.parseInt(item.dataset.boardIndex!)
                boardData.value[boardIndex].tasks.splice(newIndex, 0, boardData.value[boardIndex].tasks.splice(oldIndex, 1)[0])
                useFaToast().info(`Task sorted from ${oldIndex} to ${newIndex} within board ${boardIndex}`)
              }
            },
          })
          // 将sortable实例保存到Map中，避免重复初始化
          taskSortableMap.set(container, sortable)
        }
      })
    }
  })
}

watch(() => boardContainerRef.value, (val) => {
  if (val) {
    // eslint-disable-next-line no-new
    new Sortable(val, {
      animation: 200,
      ghostClass: 'opacity-0',
      handle: '.drag-handle',
      onUpdate: (e) => {
        const { oldIndex, newIndex } = e
        if (oldIndex === undefined || newIndex === undefined) {
          return
        }
        boardData.value.splice(newIndex, 0, boardData.value.splice(oldIndex, 1)[0])
        useFaToast().info(`Board sort from ${oldIndex} to ${newIndex}`)
      },
    })
    // 初始化已有的任务拖拽功能
    initTaskSortable()
  }
})

function handleTaskClick() {
  useFaToast().info('Task clicked')
}

function handleAddBoard() {
  // 模拟添加看板
  boardData.value.push({
    id: boardData.value.length + 1,
    name: '新看板',
    tasks: [],
  })
  // 添加新看板后重新初始化任务拖拽功能
  initTaskSortable()
}

function handleAddTask(borderId: number) {
  // 模拟添加任务
  const borderIndex = boardData.value.findIndex(board => board.id === borderId)
  boardData.value[borderIndex].tasks.push({
    id: boardData.value.reduce((total, board) => total + board.tasks.length, 0) + 1,
    title: '新任务',
    description: '这是新任务的描述',
    avatars: [],
    progress: 0,
  })
}
</script>

<template>
  <div ref="boardContainerRef" class="p-4 bg-background flex gap-4 inset-0 absolute overflow-x-auto snap-x snap-mandatory">
    <FaPageMain v-for="(board, boardIndex) in boardData" :key="board.id" class="m-0 flex-shrink-0 w-100 overflow-hidden snap-center" main-class="p-0 flex flex-1 flex-col min-h-0">
      <template #title>
        <div class="flex-center-between">
          <div class="text-sm font-semibold flex-center-start gap-2">
            <div class="cursor-pointer hover:opacity-50">
              {{ board.name }}
            </div>
            <FaBadge v-if="board.tasks.length > 0" :value="board.tasks.length" />
          </div>
          <div>
            <FaButton variant="ghost" size="icon-sm" class="drag-handle size-8 hover:bg-border hover:cursor-grab">
              <FaIcon name="i-material-symbols:drag-indicator" class="size-4" />
            </FaButton>
            <FaButton variant="ghost" size="icon-sm" class="size-8 hover:bg-border" @click="handleAddTask(board.id)">
              <FaIcon name="i-material-symbols:add-circle-outline" class="size-4" />
            </FaButton>
          </div>
        </div>
      </template>
      <FaScrollArea mask class="flex-1">
        <div ref="taskContainerRef" :data-board-index="boardIndex" class="py-3 min-h-full space-y-3">
          <FaCard v-for="(task, taskIndex) in board.tasks" :key="`${board.id}-${task.id}`" :title="task.title" :description="task.description" class="task mx-3 bg-background cursor-grab shadow-none" content-class="flex-center-between" :data-board-index="boardIndex" :data-task-index="taskIndex" @click="handleTaskClick">
            <div class="flex space-x--2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background">
              <FaAvatar v-for="(avatar, avatarIndex) in task.avatars" :key="avatarIndex" :src="`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${avatar}`" class="size-6" />
            </div>
            <div class="px-2 py-1 border rounded-lg flex gap-1 items-center">
              <div class="size-4 relative">
                <svg class="size-full -rotate-90" viewBox="0 0 40 40">
                  <circle cx="20" cy="20" r="16" fill="none" class="text-primary/20 stroke-current" stroke-width="4" />
                  <circle cx="20" cy="20" r="16" fill="none" class="text-primary stroke-current" stroke-width="4" stroke-dasharray="100" :stroke-dashoffset="100 - task.progress" stroke-linecap="round" />
                </svg>
              </div>
              <div class="text-sm">
                {{ task.progress }}%
              </div>
            </div>
          </FaCard>
        </div>
      </FaScrollArea>
    </FaPageMain>
    <FaPageMain class="group m-0 px-4 border-0 bg-muted flex-shrink-0 cursor-pointer hover:bg-border" main-class="p-0 flex-center flex-1 min-h-0" @click="handleAddBoard">
      <FaIcon name="i-material-symbols:add-circle-outline" class="opacity-30 size-6 transition-opacity group-hover:opacity-50" />
    </FaPageMain>
  </div>
</template>
