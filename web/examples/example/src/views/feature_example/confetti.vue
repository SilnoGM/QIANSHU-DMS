<i18n lang="yaml">
zh-cn:
  description: 在成功完成注册或付款等活动后使用的庆祝动画，基于 canvas-confetti，更多选项设置请查看官方文档
  confetti: 庆祝动画
  realisticLook: 真实效果
  fireworks: 烟花
  stars: 星星
  snow: 雪花
  schoolPride: 学校骄傲
zh-tw:
  description: 在成功完成註冊或付款等活动后使用的慶祝動畫，基于 canvas-confetti，更多选项设置请查看官方文档
  confetti: 庆祝動畫
  realisticLook: 真實效果
  fireworks: 烟花
  stars: 星星
  snow: 雪花
  schoolPride: 學院驕傲
en:
  description: A celebration animation used after successfully registering or making a payment, based on canvas-confetti. More options can be set by referring to the official documentation.
  confetti: Celebration Animation
  realisticLook: Realistic Look
  fireworks: Fireworks
  stars: Stars
  snow: Snow
  schoolPride: School Pride
</i18n>

<script setup lang="ts">
const { t } = useI18n()
const confetti = useConfetti()

function handleClick1() {
  confetti({
    zIndex: 3000,
    particleCount: 100,
    spread: 70,
  })
}

function handleClick2() {
  const count = 200
  const defaults = {
    zIndex: 3000,
    origin: { y: 0.7 },
  }

  function fire(particleRatio: number, opts: any) {
    confetti({
      ...defaults,
      ...opts,
      particleCount: Math.floor(count * particleRatio),
    })
  }

  fire(0.25, {
    spread: 26,
    startVelocity: 55,
  })
  fire(0.2, {
    spread: 60,
  })
  fire(0.35, {
    spread: 100,
    decay: 0.91,
    scalar: 0.8,
  })
  fire(0.1, {
    spread: 120,
    startVelocity: 25,
    decay: 0.92,
    scalar: 1.2,
  })
  fire(0.1, {
    spread: 120,
    startVelocity: 45,
  })
}

function handleClick3() {
  const duration = 15 * 1000
  const animationEnd = Date.now() + duration
  const defaults = {
    zIndex: 3000,
    startVelocity: 30,
    spread: 360,
    ticks: 60,
  }

  function randomInRange(min: number, max: number) {
    return Math.random() * (max - min) + min
  }

  const interval = window.setInterval(() => {
    const timeLeft = animationEnd - Date.now()

    if (timeLeft <= 0) {
      return clearInterval(interval)
    }

    const particleCount = 50 * (timeLeft / duration)
    // 由于粒子会落下，起点稍微高一点比随机开始好一些
    confetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
    })
    confetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
    })
  }, 250)
}

function handleClick4() {
  const defaults = {
    zIndex: 3000,
    spread: 360,
    ticks: 50,
    gravity: 0,
    decay: 0.94,
    startVelocity: 30,
    colors: ['FFE400', 'FFBD00', 'E89400', 'FFCA6C', 'FDFFB8'],
  }

  function shoot() {
    confetti({
      ...defaults,
      particleCount: 40,
      scalar: 1.2,
      shapes: ['star'],
    })

    confetti({
      ...defaults,
      particleCount: 10,
      scalar: 0.75,
      shapes: ['circle'],
    })
  }

  setTimeout(shoot, 0)
  setTimeout(shoot, 100)
  setTimeout(shoot, 200)
}

function handleClick5() {
  const duration = 15 * 1000
  const animationEnd = Date.now() + duration
  let skew = 1

  function randomInRange(min: number, max: number) {
    return Math.random() * (max - min) + min
  }

  ;(function frame() {
    const timeLeft = animationEnd - Date.now()
    const ticks = Math.max(200, 500 * (timeLeft / duration))
    skew = Math.max(0.8, skew - 0.001)

    confetti({
      zIndex: 3000,
      particleCount: 1,
      startVelocity: 0,
      ticks,
      origin: {
        x: Math.random(),
        // 由于粒子向下坠落，倾斜开始朝向顶部
        y: Math.random() * skew - 0.2,
      },
      colors: ['#ffffff'],
      shapes: ['circle'],
      gravity: randomInRange(0.4, 0.6),
      scalar: randomInRange(0.4, 1),
      drift: randomInRange(-0.4, 0.4),
    })

    if (timeLeft > 0) {
      requestAnimationFrame(frame)
    }
  })()
}

function handleClick6() {
  const end = Date.now() + 15 * 1000

  const colors = ['#bb0000', '#ffffff']

  ;(function frame() {
    confetti({
      zIndex: 3000,
      particleCount: 2,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.5 },
      colors,
    })
    confetti({
      zIndex: 3000,
      particleCount: 2,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.5 },
      colors,
    })

    if (Date.now() < end) {
      requestAnimationFrame(frame)
    }
  })()
}

function handleClick7() {
  const scalar = 2
  const unicorn = confetti.shapeFromText({ text: '🦄', scalar })

  const defaults = {
    zIndex: 3000,
    spread: 360,
    ticks: 60,
    gravity: 0,
    decay: 0.96,
    startVelocity: 20,
    shapes: [unicorn],
    scalar,
  }

  function shoot() {
    confetti({
      ...defaults,
      particleCount: 30,
    })

    confetti({
      ...defaults,
      particleCount: 5,
      flat: true,
    })

    confetti({
      ...defaults,
      particleCount: 15,
      scalar: scalar / 2,
      shapes: ['circle'],
    })
  }

  setTimeout(shoot, 0)
  setTimeout(shoot, 100)
  setTimeout(shoot, 200)
}

function open(url: string) {
  window.open(url, '_blank')
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.confetti')" :description="t('description')">
      <FaButton variant="outline" size="icon" @click="open('https://github.com/catdad/canvas-confetti')">
        <FaIcon name="i-simple-icons:github" />
      </FaButton>
    </FaPageHeader>
    <FaPageMain main-class="flex gap-2">
      <FaButton @click="handleClick1">
        {{ t('confetti') }}
      </FaButton>
      <FaButton @click="handleClick2">
        {{ t('realisticLook') }}
      </FaButton>
      <FaButton @click="handleClick3">
        {{ t('fireworks') }}
      </FaButton>
      <FaButton @click="handleClick4">
        {{ t('stars') }}
      </FaButton>
      <FaButton @click="handleClick5">
        {{ t('snow') }}
      </FaButton>
      <FaButton @click="handleClick6">
        {{ t('schoolPride') }}
      </FaButton>
      <FaButton @click="handleClick7">
        Emoji
      </FaButton>
    </FaPageMain>
  </div>
</template>
