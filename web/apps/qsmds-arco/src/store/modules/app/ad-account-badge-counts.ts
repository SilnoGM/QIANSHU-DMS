import { ref } from 'vue'

/**
 * 广告账户菜单徽章的唯一可变计数源。
 *
 * 与静态节点徽章同理：只依赖 Vue，不依赖 Pinia、API 或应用别名，
 * 路由模块因此仍可被 Node 测试直接导入。
 */
export const adAccountBadgeCounts = {
  mine: ref(0),
  all: ref(0),
}
