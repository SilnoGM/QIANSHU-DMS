<script setup lang="ts">
defineOptions({
  name: 'AppLoginCollage',
})

defineProps<{
  dark?: boolean
  title: string
}>()
</script>

<template>
  <div class="collage" :class="{ 'is-dark': dark }" aria-hidden="true">
    <div class="collage-backdrop" />

    <div class="collage-toolbar">
      <div class="tool-icon tool-icon--sales" title="销售订单">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
      </div>
      <div class="tool-icon tool-icon--purchase" title="采购管理">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
      </div>
      <div class="tool-icon tool-icon--warehouse" title="仓储库存">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
      </div>
      <div class="tool-icon tool-icon--finance" title="财务资金">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      </div>
    </div>

    <div class="collage-window">
      <div class="window-bar">
        <span class="window-dot" />
        <span class="window-dot" />
        <span class="window-dot" />
        <span class="window-url">dms.qianshu.ltd</span>
      </div>
      <div class="window-body">
        <div class="window-brand">
          <img class="window-logo" src="@/assets/images/logo.svg" alt="">
          <FaTextShiny class="window-name">
            {{ title }}
          </FaTextShiny>
          <span class="window-badge">DMS</span>
        </div>
        <p class="window-title">
          产品流转与资金同频<br><span>业务协同与财务一体</span>
        </p>
        <div class="window-features">
          <span class="feature"><span class="feature-check">✓</span>销售开单</span>
          <span class="feature"><span class="feature-check">✓</span>采购协同</span>
          <span class="feature"><span class="feature-check">✓</span>仓储联动</span>
          <span class="feature"><span class="feature-check">✓</span>财务归集</span>
        </div>
      </div>
    </div>

    <div class="float-card float-card--inbound">
      <div class="float-card__bar">
        <i />
        已入库
      </div>
      <div class="float-card__body">
        <span class="float-avatar">货</span>
        <span class="float-lines"><span class="float-line" /><span class="float-line float-line--short" /></span>
      </div>
    </div>

    <div class="collage-link" />
    <div class="collage-plus">
      +
    </div>
    <svg class="collage-cursor" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 2l16 10-7 2 4 7-3 1.5-4-7-5 4.5z" /></svg>

    <div class="pie-card">
      <span class="pie-lines">
        <span class="pie-line"><span class="pie-dot pie-dot--finance" /><span class="pie-line-bar pie-line-bar--sm" /></span>
        <span class="pie-line"><span class="pie-dot pie-dot--primary" /><span class="pie-line-bar pie-line-bar--md" /></span>
        <span class="pie-line"><span class="pie-dot pie-dot--teal" /><span class="pie-line-bar pie-line-bar--xs" /></span>
      </span>
      <svg class="pie-chart" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15.9" stroke="var(--pie-track)" />
        <circle cx="18" cy="18" r="15.9" stroke="var(--pie-primary)" stroke-dasharray="55 45" stroke-dashoffset="0" />
        <circle cx="18" cy="18" r="15.9" stroke="var(--pie-finance)" stroke-dasharray="28 72" stroke-dashoffset="-57" />
        <circle cx="18" cy="18" r="15.9" stroke="var(--pie-teal)" stroke-dasharray="15 85" stroke-dashoffset="-86" />
      </svg>
    </div>

    <div class="float-card float-card--finance">
      <div class="float-card__bar">
        <i />
        已核算
      </div>
      <div class="float-card__body">
        <span class="float-avatar">¥</span>
        <span class="float-lines"><span class="float-line" /><span class="float-line float-line--short" /></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.collage {
  --sales: oklch(72% 0.15 55deg);
  --purchase: oklch(65% 0.12 235deg);
  --finance: oklch(75% 0.14 75deg);
  --accent-text: oklch(var(--primary));
  --pie-track: oklch(var(--muted));
  --pie-primary: oklch(var(--primary));
  --pie-finance: var(--finance);
  --pie-teal: color-mix(in oklch, oklch(var(--primary)), white 35%);

  position: relative;
  min-width: 0;
  height: 500px;
  user-select: none;
}

.collage.is-dark {
  --accent-text: color-mix(in oklch, oklch(var(--primary)), white 38%);
}

.collage-backdrop {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 0;
  width: 480px;
  height: 340px;
  background: oklch(var(--primary) / 5%);
  border: 1px solid oklch(var(--primary) / 10%);
  border-radius: 16px;
  transform: translate(-50%, -50%) translate(-24px, -26px);
}

.collage-toolbar {
  position: absolute;
  top: 54px;
  left: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 58px;
  padding: 10px;
  background: oklch(var(--card));
  border: 1px solid oklch(var(--border));
  border-radius: 16px;
  box-shadow: 0 12px 32px -4px rgb(6 78 59 / 10%);
  animation: float-a 6.5s ease-in-out infinite;
}

.tool-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
}

.tool-icon svg {
  width: 18px;
  height: 18px;
}

.tool-icon--sales {
  color: var(--sales);
  background: color-mix(in oklch, oklch(var(--card)), var(--sales) 10%);
}

.tool-icon--purchase {
  color: var(--purchase);
  background: color-mix(in oklch, oklch(var(--card)), var(--purchase) 10%);
}

.tool-icon--warehouse {
  color: var(--accent-text);
  background: color-mix(in oklch, var(--accent-text), transparent 92%);
}

.tool-icon--finance {
  color: var(--finance);
  background: color-mix(in oklch, oklch(var(--card)), var(--finance) 12%);
}

.collage-window {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 10;
  width: 490px;
  overflow: hidden;
  background: oklch(var(--card));
  border: 1px solid oklch(var(--border));
  border-radius: 16px;
  box-shadow: 0 24px 54px -18px rgb(6 78 59 / 16%), 0 0 15px rgb(6 78 59 / 4%);
  transform: translate(-50%, -50%);
}

.window-bar {
  display: flex;
  gap: 6px;
  align-items: center;
  height: 36px;
  padding: 0 14px;
  background: linear-gradient(90deg, oklch(var(--primary)), color-mix(in oklch, oklch(var(--primary)), white 24%));
}

.window-dot {
  width: 8px;
  height: 8px;
  background: rgb(255 255 255 / 60%);
  border-radius: 50%;
}

.window-url {
  margin-left: 8px;
  font-family: var(--qs-font-mono);
  font-size: 10px;
  color: rgb(255 255 255 / 90%);
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.window-body {
  padding: 26px 32px 30px;
}

.window-brand {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 18px;
}

.window-logo {
  display: block;
  flex: none;
  width: 40px;
  height: 40px;
  object-fit: contain;
}

.collage.is-dark .window-logo {
  filter: drop-shadow(0 0 1px rgb(255 255 255 / 55%));
}

.window-name {
  font-size: 18px;
  font-weight: 700;
  line-height: 26px;
  color: oklch(var(--foreground));
  white-space: nowrap;
}

.window-badge {
  padding: 2px 6px;
  font-family: var(--qs-font-mono);
  font-size: 9px;
  font-weight: 600;
  line-height: 12px;
  color: var(--accent-text);
  background: color-mix(in oklch, var(--accent-text), transparent 93%);
  border: 1px solid color-mix(in oklch, var(--accent-text), transparent 78%);
  border-radius: 4px;
}

.window-title {
  margin: 0 0 20px;
  font-size: 30px;
  font-weight: 700;
  line-height: 40px;
  color: oklch(var(--foreground));
  letter-spacing: -0.02em;
}

.window-title span {
  color: var(--accent-text);
}

.window-features {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: oklch(var(--foreground));
}

.feature {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  white-space: nowrap;
}

.feature-check {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  color: oklch(var(--primary-foreground));
  background: oklch(var(--primary));
  border-radius: 50%;
}

.float-card {
  position: absolute;
  z-index: 20;
  width: 208px;
  overflow: hidden;
  background: oklch(var(--card));
  border: 1px solid oklch(var(--border));
  border-radius: 14px;
  box-shadow: 0 12px 32px -4px rgb(6 78 59 / 10%);
}

.float-card__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 12px;
  font-size: 10px;
  font-weight: 500;
  line-height: 14px;
  color: rgb(255 255 255 / 94%);
}

.float-card__bar i {
  display: block;
  width: 58px;
  height: 8px;
  background: rgb(255 255 255 / 50%);
  border-radius: 999px;
}

.float-card__body {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px;
}

.float-avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 50%;
}

.float-lines {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
}

.float-line {
  height: 8px;
  background: oklch(var(--muted));
  border-radius: 999px;
}

.float-line--short {
  width: 64%;
  background: oklch(var(--muted) / 75%);
}

.float-card--inbound {
  top: 0;
  right: 0;
  animation: float-b 7.5s ease-in-out 0.9s infinite;
}

.float-card--inbound .float-card__bar {
  background: linear-gradient(90deg, color-mix(in oklch, oklch(var(--primary)), white 22%), oklch(var(--primary)));
}

.float-card--inbound .float-avatar {
  color: oklch(var(--primary));
  background: oklch(var(--primary) / 10%);
}

.float-card--finance {
  right: 0;
  bottom: 16px;
  animation: float-d 9.5s ease-in-out 1.6s infinite;
}

.float-card--finance .float-card__bar {
  background: linear-gradient(90deg, var(--finance), color-mix(in oklch, var(--finance), white 20%));
}

.float-card--finance .float-avatar {
  color: var(--finance);
  background: color-mix(in oklch, oklch(var(--card)), var(--finance) 14%);
}

.pie-card {
  position: absolute;
  bottom: 0;
  left: 0;
  z-index: 20;
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  width: 238px;
  padding: 14px;
  background: oklch(var(--card));
  border: 1px solid oklch(var(--border));
  border-radius: 14px;
  box-shadow: 0 12px 32px -4px rgb(6 78 59 / 10%);
  animation: float-c 8.5s ease-in-out 0.4s infinite;
}

.pie-lines {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 7px;
}

.pie-line {
  display: flex;
  gap: 6px;
  align-items: center;
}

.pie-dot {
  width: 6px;
  height: 6px;
  border-radius: 2px;
}

.pie-dot--finance {
  background: var(--finance);
}

.pie-dot--primary {
  background: oklch(var(--primary));
}

.pie-dot--teal {
  background: var(--pie-teal);
}

.pie-line-bar {
  height: 6px;
  background: oklch(var(--muted));
  border-radius: 999px;
}

.pie-line-bar--sm {
  width: 42px;
}

.pie-line-bar--md {
  width: 58px;
}

.pie-line-bar--xs {
  width: 32px;
}

.pie-chart {
  flex: none;
  width: 66px;
  height: 66px;
  transform: rotate(-90deg);
}

.pie-chart circle {
  fill: transparent;
  stroke-width: 5;
}

.collage-link {
  position: absolute;
  top: 110px;
  right: 86px;
  bottom: 110px;
  z-index: 8;
  border-left: 2px dashed oklch(var(--primary) / 42%);
}

.collage-plus {
  position: absolute;
  top: 50%;
  right: 62px;
  z-index: 30;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  font-size: 24px;
  font-weight: 600;
  line-height: 1;
  color: var(--sales);
  background: oklch(var(--card));
  border: 1px solid oklch(var(--primary) / 14%);
  border-radius: 50%;
  box-shadow: 0 12px 32px -4px rgb(6 78 59 / 12%);
  transform: translateY(-50%);
}

.collage-cursor {
  position: absolute;
  top: calc(50% + 18px);
  right: 48px;
  z-index: 31;
  width: 26px;
  height: 26px;
  color: oklch(var(--primary));
  filter: drop-shadow(0 4px 4px rgb(0 0 0 / 12%));
  transform: rotate(-8deg);
}

@keyframes float-a {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
  }

  50% {
    transform: translate3d(0, -14px, 0);
  }
}

@keyframes float-b {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
  }

  50% {
    transform: translate3d(0, -18px, 0);
  }
}

@keyframes float-c {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
  }

  50% {
    transform: translate3d(0, -12px, 0);
  }
}

@keyframes float-d {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
  }

  50% {
    transform: translate3d(0, -16px, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .collage-toolbar,
  .float-card,
  .pie-card {
    animation: none;
  }
}
</style>
