import { ref } from 'vue'

/**
 * 菜单徽章的唯一可变计数源。
 *
 * 只依赖 Vue，不依赖 Pinia、API 或应用别名，路由模块因此仍可被 Node 测试直接导入。
 * 真正的接口刷新由 proxy-node-badge store 负责写入这里。
 */
export const proxyNodeBadgeCounts = {
  mine: ref(0),
  all: ref(0),
}
