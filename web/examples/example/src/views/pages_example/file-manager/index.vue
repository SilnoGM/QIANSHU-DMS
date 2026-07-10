<script setup lang="ts">
import type { TableColumn, TreeNode } from '@fantastic-admin/components'
import apiFileManager from '@/api/modules/fileManager'

defineOptions({
  name: 'PagesExampleFileManager',
})

// 文件视图模式
type ViewMode = 'list' | 'grid'
const viewMode = ref<ViewMode>('grid')

// 当前选中的文件夹
const currentFolder = ref('')

// 搜索关键词
const searchKeyword = ref('')

// 加载状态
const loading = ref(false)

// 树组件引用
const treeRef = ref()

// 文件夹树数据
const folderTree = ref<TreeNode[]>([])

// 文件接口
interface FileItem {
  id: string
  name: string
  type: 'file' | 'folder'
  extension?: string
  size?: number
  modifiedAt: string
  folderId: string
}

// 文件列表
const fileList = ref<FileItem[]>([])

// 表格列配置
const tableColumns: TableColumn<FileItem>[] = [
  {
    accessorKey: 'name',
    header: '名称',
  },
  {
    accessorKey: 'size',
    header: '大小',
    align: 'right',
    width: 120,
  },
  {
    accessorKey: 'modifiedAt',
    header: '修改日期',
    align: 'center',
    width: 160,
  },
  {
    id: 'actions',
    header: '',
    width: 60,
    align: 'center',
  },
]

// 文件图标映射
const fileIcons: Record<string, string> = {
  // 文档类
  'pdf': 'i-material-icon-theme:pdf',
  'doc': 'i-material-icon-theme:word',
  'docx': 'i-material-icon-theme:word',
  'ppt': 'i-material-icon-theme:powerpoint',
  'pptx': 'i-material-icon-theme:powerpoint',
  'md': 'i-material-icon-theme:markdown',

  // 图片类
  'jpg': 'i-material-icon-theme:image',
  'jpeg': 'i-material-icon-theme:image',
  'png': 'i-material-icon-theme:image',
  'gif': 'i-material-icon-theme:image',
  'svg': 'i-material-icon-theme:svg',
  'webp': 'i-material-icon-theme:image',
  'bmp': 'i-material-icon-theme:image',
  'ico': 'i-material-icon-theme:image',

  // 视频类
  'mp4': 'i-material-icon-theme:video',
  'avi': 'i-material-icon-theme:video',
  'mkv': 'i-material-icon-theme:video',
  'mov': 'i-material-icon-theme:video',
  'wmv': 'i-material-icon-theme:video',
  'flv': 'i-material-icon-theme:video',

  // 音频类
  'mp3': 'i-material-icon-theme:audio',
  'wav': 'i-material-icon-theme:audio',
  'flac': 'i-material-icon-theme:audio',
  'aac': 'i-material-icon-theme:audio',
  'ogg': 'i-material-icon-theme:audio',

  // 压缩包
  'zip': 'i-material-icon-theme:zip',
  'rar': 'i-material-icon-theme:zip',
  '7z': 'i-material-icon-theme:zip',
  'tar': 'i-material-icon-theme:zip',
  'gz': 'i-material-icon-theme:zip',

  // 代码类
  'js': 'i-material-icon-theme:javascript',
  'ts': 'i-material-icon-theme:typescript',
  'vue': 'i-material-icon-theme:vue',
  'html': 'i-material-icon-theme:html',
  'css': 'i-material-icon-theme:css',
  'scss': 'i-material-icon-theme:sass',
  'less': 'i-material-icon-theme:less',
  'json': 'i-material-icon-theme:json',
  'xml': 'i-material-icon-theme:xml',
  'yaml': 'i-material-icon-theme:yaml',
  'yml': 'i-material-icon-theme:yaml',
  'py': 'i-material-icon-theme:python',
  'java': 'i-material-icon-theme:java',
  'go': 'i-material-icon-theme:go',
  'rs': 'i-material-icon-theme:rust',
  'php': 'i-material-icon-theme:php',
  'rb': 'i-material-icon-theme:ruby',
  'swift': 'i-material-icon-theme:swift',
  'kt': 'i-material-icon-theme:kotlin',
  'c': 'i-material-icon-theme:c',
  'cpp': 'i-material-icon-theme:cpp',
  'cs': 'i-material-icon-theme:csharp',
  'ps1': 'i-material-icon-theme:powershell',

  // 其他
  'exe': 'i-material-icon-theme:exe',
  'msi': 'i-material-icon-theme:exe',
  'iso': 'i-material-icon-theme:disc',
  'ttf': 'i-material-icon-theme:font',
  'otf': 'i-material-icon-theme:font',
  'woff': 'i-material-icon-theme:font',
  'woff2': 'i-material-icon-theme:font',
  'eot': 'i-material-icon-theme:font',
}

// 获取文件图标
function getFileIcon(extension: string): string {
  return fileIcons[extension.toLowerCase()] || 'i-ri:file-unknow-line'
}

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return '0 B'
  }
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

// 格式化日期
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 加载文件夹树
async function loadFolderTree() {
  const res = await apiFileManager.folderTree()
  folderTree.value = res.data
  // 数据加载后展开所有节点
  await nextTick()
  treeRef.value?.expand()
}

// 加载文件列表
async function loadFileList() {
  loading.value = true
  try {
    const res = await apiFileManager.fileList({
      folderId: currentFolder.value || undefined,
      keyword: searchKeyword.value || undefined,
    })
    fileList.value = res.data
  }
  finally {
    loading.value = false
  }
}

// 当前显示的文件列表
const currentFiles = computed(() => fileList.value)

// 文件夹选择
function handleFolderSelect(node: TreeNode | null) {
  currentFolder.value = node ? node.id as string : ''
  loadFileList()
}

// 打开文件（模拟）
function handleFileClick(file: FileItem) {
  if (file.type === 'folder') {
    currentFolder.value = file.id
    loadFileList()
  }
  else {
    useFaToast().info(`打开文件：${file.name}`)
  }
}

// 删除文件（模拟）
async function handleDeleteFile(file: FileItem) {
  useFaModal().confirm({
    title: '确认删除',
    content: `确定要删除「${file.name}」吗？`,
    onConfirm: async () => {
      await apiFileManager.delete(file.id)
      useFaToast().success(`已删除：${file.name}`)
      loadFileList()
    },
  })
}

// 重命名文件（模拟）
function handleRenameFile(file: FileItem) {
  useFaToast().info(`重命名：${file.name}`)
}

// 复制文件（模拟）
function handleCopyFile(file: FileItem) {
  useFaToast().info(`已复制：${file.name}`)
}

// 获取文件右键菜单项
function getFileContextItems(file: FileItem) {
  return [
    [
      {
        label: '打开',
        icon: file.type === 'folder' ? 'i-ri:folder-open-line' : 'i-ri:file-line',
        handle: () => handleFileClick(file),
      },
    ],
    [
      {
        label: '重命名',
        icon: 'i-ri:edit-line',
        handle: () => handleRenameFile(file),
      },
      {
        label: '复制',
        icon: 'i-ri:file-copy-line',
        handle: () => handleCopyFile(file),
      },
    ],
    [
      {
        label: '删除',
        icon: 'i-ri:delete-bin-line',
        variant: 'destructive' as const,
        handle: () => handleDeleteFile(file),
      },
    ],
  ]
}

// 新建文件夹（模拟）
function handleCreateFolder() {
  useFaToast().info('新建文件夹')
}

// 上传文件（模拟）
function handleUpload() {
  useFaToast().info('上传文件')
}

// 搜索防抖
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchKeyword, () => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  searchTimer = setTimeout(() => {
    loadFileList()
  }, 300)
})

// 获取文件夹路径
function getFolderPath(folderId: string): string[] {
  const path: string[] = []

  function findPath(nodes: any[], targetId: string, currentPath: string[]): boolean {
    for (const node of nodes) {
      const newPath = [...currentPath, node.label]
      if (node.id === targetId) {
        path.push(...newPath)
        return true
      }
      if (node.children && findPath(node.children, targetId, newPath)) {
        return true
      }
    }
    return false
  }

  findPath(folderTree.value, folderId, [])
  return path
}

// 当前路径显示
const currentPath = computed(() => {
  if (!currentFolder.value) {
    return ''
  }
  const path = getFolderPath(currentFolder.value)
  return path.join(' / ')
})

// 初始化
onMounted(() => {
  loadFolderTree()
  loadFileList()
})
</script>

<template>
  <div class="flex flex-col size-full absolute">
    <FaPageHeader title="文件管理" description="模拟文件管理系统，支持列表和图标两种视图模式。" class="mb-0" default-class="flex items-center gap-2">
      <FaButton variant="outline" @click="handleUpload">
        <FaIcon name="i-ri:upload-2-line" />
        上传
      </FaButton>
      <FaButton @click="handleCreateFolder">
        <FaIcon name="i-ri:folder-add-line" />
        新建文件夹
      </FaButton>
    </FaPageHeader>
    <FaLayoutContainer left-side-width="260px" hide-left-side-toggle class="p-4 flex-1 min-h-0" left-side-class="h-full flex flex-col p-0" default-class="flex flex-col flex-1 min-h-0 p-0">
      <template #leftSide>
        <FaScrollArea>
          <FaTree
            ref="treeRef"
            :data="folderTree"
            node-key="id"
            class="p-2"
            @selection-change="handleFolderSelect"
          />
        </FaScrollArea>
      </template>
      <div class="flex flex-1 flex-col min-h-0">
        <!-- 工具栏 -->
        <div class="p-2 border-b flex gap-3 items-center justify-between">
          <div class="flex gap-2 items-center">
            <FaInput
              v-model="searchKeyword"
              placeholder="搜索文件..."
              class="w-64"
              clearable
            >
              <template #start>
                <FaIcon name="i-ri:search-line" class="text-muted-foreground" />
              </template>
            </FaInput>
          </div>
          <div class="flex gap-1 items-center">
            <FaButton
              variant="ghost"
              size="icon"
              :class="{ 'bg-muted': viewMode === 'grid' }"
              @click="viewMode = 'grid'"
            >
              <FaIcon name="i-ri:grid-line" />
            </FaButton>
            <FaButton
              variant="ghost"
              size="icon"
              :class="{ 'bg-muted': viewMode === 'list' }"
              @click="viewMode = 'list'"
            >
              <FaIcon name="i-ri:list-unordered" />
            </FaButton>
          </div>
        </div>

        <!-- 文件内容区 -->
        <FaScrollArea class="flex-1">
          <!-- 空状态 -->
          <div v-if="currentFiles.length === 0" class="py-20 flex flex-col items-center justify-center">
            <FaIcon name="i-ri:folder-open-line" class="text-muted-foreground/50 size-16" />
            <p class="text-sm text-muted-foreground mt-4">
              此文件夹为空
            </p>
          </div>

          <!-- 图标视图 -->
          <div v-else-if="viewMode === 'grid'" class="p-3 gap-3 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
            <FaContextMenu
              v-for="file in currentFiles"
              :key="file.id"
              :items="getFileContextItems(file)"
            >
              <div
                class="group p-3 rounded-lg flex flex-col gap-2 cursor-pointer transition-colors items-center hover:bg-muted/50"
                @click="handleFileClick(file)"
              >
                <FaIcon
                  :name="file.type === 'folder' ? 'i-material-icon-theme:folder' : getFileIcon(file.extension || '')"
                  class="size-12"
                />
                <div class="text-center w-full">
                  <div class="text-xs truncate">
                    {{ file.name }}
                  </div>
                  <div v-if="file.size" class="text-xs text-muted-foreground mt-0.5">
                    {{ formatFileSize(file.size) }}
                  </div>
                </div>
              </div>
            </FaContextMenu>
          </div>

          <!-- 列表视图 -->
          <FaTable
            v-else
            class="flex-1 h-full min-h-0"
            table-root-class="overflow-hidden"
            :columns="tableColumns"
            :data="currentFiles"
            row-key="id"
            stripe
          >
            <template #cell-name="{ row }">
              <div
                class="flex gap-2 cursor-pointer items-center"
                @click="handleFileClick(row.original)"
              >
                <FaIcon
                  :name="row.original.type === 'folder' ? 'i-material-icon-theme:folder' : getFileIcon(row.original.extension || '')"
                  class="shrink-0 size-5"
                />
                <span class="text-sm truncate">{{ row.original.name }}</span>
              </div>
            </template>
            <template #cell-size="{ row }">
              <span class="text-sm text-muted-foreground">
                {{ row.original.size ? formatFileSize(row.original.size) : '--' }}
              </span>
            </template>
            <template #cell-modifiedAt="{ row }">
              <span class="text-sm text-muted-foreground">
                {{ formatDate(row.original.modifiedAt) }}
              </span>
            </template>
            <template #cell-actions="{ row }">
              <FaDropdown :items="getFileContextItems(row.original)" align="end">
                <FaButton
                  variant="ghost"
                  size="icon-sm"
                  @click.stop
                >
                  <FaIcon name="i-ri:more-2-fill" class="size-4" />
                </FaButton>
              </FaDropdown>
            </template>
          </FaTable>
        </FaScrollArea>

        <!-- 状态栏 -->
        <div class="text-xs text-muted-foreground px-2 py-1.5 border-t bg-muted/30 flex items-center justify-between">
          <span>{{ currentFiles.length }} 个项目</span>
          <span v-if="currentPath">{{ currentPath }}</span>
        </div>
      </div>
    </FaLayoutContainer>
  </div>
</template>
