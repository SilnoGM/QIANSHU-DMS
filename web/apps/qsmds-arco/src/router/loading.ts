export const APP_LOADING_MINIMUM_DURATION_ANIMATION = 'qianshu-loading-minimum-duration'

interface AppLoadingAnimation {
  readonly animationName?: string
  readonly finished: Promise<unknown>
}

interface AppLoadingElement {
  getAnimations: () => AppLoadingAnimation[]
}

/**
 * 等待 Loading 根节点的最短展示动画完成后再开始淡出。
 * 动画已结束时不会出现在 getAnimations() 结果中，因此慢加载不会被额外追加 1500ms。
 */
export async function finishAppLoadingAfterMinimumDuration(
  loadingElement: AppLoadingElement | null,
  fadeOut: () => void,
) {
  try {
    const minimumDurationAnimation = loadingElement
      ?.getAnimations()
      .find(animation => animation.animationName === APP_LOADING_MINIMUM_DURATION_ANIMATION)

    if (minimumDurationAnimation) {
      await minimumDurationAnimation.finished
    }
  }
  catch {
    // DOM 被替换或动画被取消时 finished 会拒绝；此时仍须解除遮罩，避免阻塞应用。
  }

  fadeOut()
}
