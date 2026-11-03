import type { InjectionKey, Ref } from 'vue'

/** 页面级共享的 1 秒时钟；卡片只消费这个 Ref，不各自创建 timer。 */
export const PROXY_NODE_NOW_KEY: InjectionKey<Ref<number>> = Symbol(
  'qs.proxy-node.now',
)
