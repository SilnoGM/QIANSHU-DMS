import { defineFakeRoute } from 'vite-plugin-fake-server/client'

// 文件夹树数据
const folderTree = [
  {
    id: 'root',
    label: '全部文件',
    children: [
      {
        id: 'documents',
        label: '文档',
        children: [
          { id: 'work', label: '工作' },
          { id: 'personal', label: '个人' },
        ],
      },
      {
        id: 'images',
        label: '图片',
        children: [
          { id: 'photos', label: '照片' },
          { id: 'screenshots', label: '截图' },
          { id: 'wallpapers', label: '壁纸' },
        ],
      },
      {
        id: 'videos',
        label: '视频',
      },
      {
        id: 'music',
        label: '音乐',
      },
      {
        id: 'downloads',
        label: '下载',
      },
      {
        id: 'archives',
        label: '压缩包',
      },
    ],
  },
]

// 文件数据
const fileList = [
  // 文档 - 工作
  { id: '1', name: '项目计划书.docx', type: 'file', extension: 'docx', size: 256000, modifiedAt: '2024-01-15T10:30:00', folderId: 'work' },
  { id: '2', name: '会议纪要.pdf', type: 'file', extension: 'pdf', size: 128000, modifiedAt: '2024-01-14T09:15:00', folderId: 'work' },
  { id: '3', name: '财务报表.xlsx', type: 'file', extension: 'xlsx', size: 512000, modifiedAt: '2024-01-13T14:20:00', folderId: 'work' },
  { id: '4', name: '产品需求.pptx', type: 'file', extension: 'pptx', size: 1024000, modifiedAt: '2024-01-12T16:45:00', folderId: 'work' },
  { id: '5', name: '代码规范.md', type: 'file', extension: 'md', size: 32000, modifiedAt: '2024-01-11T11:00:00', folderId: 'work' },
  { id: '25', name: 'index.vue', type: 'file', extension: 'vue', size: 8000, modifiedAt: '2024-01-15T08:00:00', folderId: 'work' },
  { id: '26', name: 'main.ts', type: 'file', extension: 'ts', size: 2000, modifiedAt: '2024-01-14T08:00:00', folderId: 'work' },
  { id: '27', name: 'styles.css', type: 'file', extension: 'css', size: 4000, modifiedAt: '2024-01-13T08:00:00', folderId: 'work' },
  { id: '28', name: 'config.json', type: 'file', extension: 'json', size: 1000, modifiedAt: '2024-01-12T08:00:00', folderId: 'work' },
  { id: '29', name: 'data.sql', type: 'file', extension: 'sql', size: 16000, modifiedAt: '2024-01-11T08:00:00', folderId: 'work' },

  // 文档 - 个人
  { id: '6', name: '读书笔记.txt', type: 'file', extension: 'txt', size: 16000, modifiedAt: '2024-01-10T10:00:00', folderId: 'personal' },
  { id: '7', name: '旅行攻略.pdf', type: 'file', extension: 'pdf', size: 384000, modifiedAt: '2024-01-09T15:30:00', folderId: 'personal' },

  // 图片 - 照片
  { id: '8', name: '风景照片.jpg', type: 'file', extension: 'jpg', size: 2048000, modifiedAt: '2024-01-08T12:00:00', folderId: 'photos' },
  { id: '9', name: '人像摄影.png', type: 'file', extension: 'png', size: 3072000, modifiedAt: '2024-01-07T16:20:00', folderId: 'photos' },
  { id: '10', name: '美食照片.jpeg', type: 'file', extension: 'jpeg', size: 1536000, modifiedAt: '2024-01-06T18:45:00', folderId: 'photos' },

  // 图片 - 截图
  { id: '11', name: '屏幕截图 2024-01-15.png', type: 'file', extension: 'png', size: 512000, modifiedAt: '2024-01-15T20:00:00', folderId: 'screenshots' },
  { id: '12', name: '设计稿.png', type: 'file', extension: 'png', size: 1024000, modifiedAt: '2024-01-14T10:30:00', folderId: 'screenshots' },

  // 图片 - 壁纸
  { id: '13', name: '桌面壁纸.jpg', type: 'file', extension: 'jpg', size: 4096000, modifiedAt: '2024-01-13T09:00:00', folderId: 'wallpapers' },
  { id: '14', name: '手机壁纸.webp', type: 'file', extension: 'webp', size: 768000, modifiedAt: '2024-01-12T11:20:00', folderId: 'wallpapers' },

  // 视频
  { id: '15', name: '产品演示.mp4', type: 'file', extension: 'mp4', size: 52428800, modifiedAt: '2024-01-11T14:00:00', folderId: 'videos' },
  { id: '16', name: '会议录像.mkv', type: 'file', extension: 'mkv', size: 104857600, modifiedAt: '2024-01-10T16:30:00', folderId: 'videos' },

  // 音乐
  { id: '17', name: '背景音乐.mp3', type: 'file', extension: 'mp3', size: 5120000, modifiedAt: '2024-01-09T12:00:00', folderId: 'music' },
  { id: '18', name: '音效.wav', type: 'file', extension: 'wav', size: 2048000, modifiedAt: '2024-01-08T10:15:00', folderId: 'music' },

  // 下载
  { id: '19', name: 'VSCode.exe', type: 'file', extension: 'exe', size: 81920000, modifiedAt: '2024-01-07T09:00:00', folderId: 'downloads' },
  { id: '20', name: 'Node.js.msi', type: 'file', extension: 'msi', size: 32768000, modifiedAt: '2024-01-06T14:30:00', folderId: 'downloads' },
  { id: '21', name: 'Chrome.dmg', type: 'file', extension: 'dmg', size: 102400000, modifiedAt: '2024-01-05T11:45:00', folderId: 'downloads' },

  // 压缩包
  { id: '22', name: '项目源码.zip', type: 'file', extension: 'zip', size: 20480000, modifiedAt: '2024-01-04T16:00:00', folderId: 'archives' },
  { id: '23', name: '备份文件.rar', type: 'file', extension: 'rar', size: 10240000, modifiedAt: '2024-01-03T10:30:00', folderId: 'archives' },
  { id: '24', name: '资源包.7z', type: 'file', extension: '7z', size: 5120000, modifiedAt: '2024-01-02T08:00:00', folderId: 'archives' },

  // 根目录文件
  { id: '30', name: 'README.md', type: 'file', extension: 'md', size: 4000, modifiedAt: '2024-01-15T09:00:00', folderId: 'root' },
  { id: '31', name: 'package.json', type: 'file', extension: 'json', size: 2000, modifiedAt: '2024-01-14T09:00:00', folderId: 'root' },
  { id: '32', name: 'tsconfig.json', type: 'file', extension: 'json', size: 1500, modifiedAt: '2024-01-13T09:00:00', folderId: 'root' },
]

export default defineFakeRoute([
  {
    url: '/fake/file-manager/folder-tree',
    method: 'get',
    response: () => {
      return {
        error: '',
        status: 1,
        data: folderTree,
      }
    },
  },
  {
    url: '/fake/file-manager/file-list',
    method: 'get',
    response: ({ query }) => {
      const { folderId, keyword } = query
      let files = [...fileList]

      // 按文件夹筛选
      if (folderId) {
        // 获取所有子文件夹 ID
        const folderIds: string[] = [folderId as string]
        function collectFolderIds(nodes: any[]) {
          for (const node of nodes) {
            if (node.id === folderId && node.children) {
              const addChildren = (children: any[]) => {
                for (const child of children) {
                  folderIds.push(child.id)
                  if (child.children) {
                    addChildren(child.children)
                  }
                }
              }
              addChildren(node.children)
              break
            }
            if (node.children) {
              collectFolderIds(node.children)
            }
          }
        }
        collectFolderIds(folderTree)
        files = files.filter(file => folderIds.includes(file.folderId))
      }

      // 按关键词筛选
      if (keyword) {
        const kw = (keyword as string).toLowerCase()
        files = files.filter(file => file.name.toLowerCase().includes(kw))
      }

      return {
        error: '',
        status: 1,
        data: files,
      }
    },
  },
  {
    url: '/fake/file-manager/delete',
    method: 'post',
    response: () => {
      return {
        error: '',
        status: 1,
        data: {
          isSuccess: true,
        },
      }
    },
  },
  {
    url: '/fake/file-manager/rename',
    method: 'post',
    response: () => {
      return {
        error: '',
        status: 1,
        data: {
          isSuccess: true,
        },
      }
    },
  },
])
