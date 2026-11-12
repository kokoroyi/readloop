<script setup>
/**
 * 顶栏（62px）：书页图标 + 衬线品牌、四导航（当前项下划线）、
 * 右侧 AI 状态胶囊（点击进设置 AI 分区）与主题切换按钮。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Icon from './ui/Icon.vue'
import Tip from './ui/Tip.vue'
import {
  PRIMARY_NAV,
  aiStatus,
  settingsStore,
  toggleTheme
} from '../stores/settings.js'

const route = useRoute()

const aiLabel = computed(() =>
  aiStatus.value.provider ? `${aiStatus.value.provider} · ${aiStatus.value.label}` : aiStatus.value.label
)

const aiTip = computed(() => {
  if (aiStatus.value.state === 'ok') return `${aiStatus.value.provider || 'AI'} · ${aiStatus.value.model || '已就绪'}`
  return aiStatus.value.detail || '点击进入设置 AI 配置'
})

const themeIcon = computed(() => (settingsStore.theme === 'dark' ? 'sun' : 'moon'))
const themeLabel = computed(() => (settingsStore.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'))

function isActive(path) {
  if (path === '/') return route.path === '/'
  return route.path === path || route.path.startsWith(`${path}/`)
}
</script>

<template>
  <header class="topbar">
    <RouterLink to="/" class="brand" aria-label="ReadLoop 阅读台">
      <span class="brand-mark"><Icon name="book" :size="15" /></span>
      <span class="brand-name">ReadLoop</span>
    </RouterLink>

    <nav class="nav" aria-label="主导航">
      <RouterLink
        v-for="item in PRIMARY_NAV"
        :key="item.path"
        :to="item.path"
        class="nav-item"
        :class="{ active: isActive(item.path) }"
        :aria-current="isActive(item.path) ? 'page' : undefined"
      >
        {{ item.label }}
      </RouterLink>
    </nav>

    <div class="topbar-right">
      <Tip :content="aiTip">
        <RouterLink
          to="/settings?section=ai"
          class="ai-status"
          :class="`ai-status-${aiStatus.state}`"
          aria-label="AI 状态，点击进入设置"
        >
          <span class="status-dot" />
          <span class="ai-text">{{ aiLabel }}</span>
        </RouterLink>
      </Tip>
      <Tip :content="themeLabel">
        <button class="icon-btn" type="button" :aria-label="themeLabel" @click="toggleTheme">
          <Icon :name="themeIcon" :size="16" />
        </button>
      </Tip>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  position: relative;
  z-index: var(--z-topbar);
  height: var(--topbar-h);
  flex: 0 0 var(--topbar-h);
  display: flex;
  align-items: center;
  gap: var(--space-14);
  padding: 0 var(--space-15);
  background: var(--topbar-bg);
  border-bottom: 1px solid var(--paper-line);
  backdrop-filter: blur(10px);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
}

.brand-mark {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--brand-mark-bg);
  color: var(--brand-mark-fg);
}

.brand-name {
  font-family: var(--font-serif);
  font-size: var(--text-6xl);
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--paper-ink);
}

.nav {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.nav::-webkit-scrollbar {
  display: none;
}

.nav-item {
  position: relative;
  padding: var(--space-3) var(--space-6);
  border-radius: var(--radius-md);
  font-size: var(--text-2xl);
  font-weight: 500;
  color: var(--paper-ink-2);
  white-space: nowrap;
  transition:
    color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}

.nav-item:hover {
  color: var(--paper-ink);
  background: var(--paper-surface-2);
}

.nav-item.active {
  color: var(--paper-ink);
  font-weight: 600;
}

.nav-item.active::after {
  content: "";
  position: absolute;
  left: var(--space-6);
  right: var(--space-6);
  bottom: 1px;
  height: 2px;
  border-radius: 2px;
  background: var(--paper-accent);
}

.topbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-5);
  flex: 0 0 auto;
}

.ai-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: 30px;
  padding: 0 var(--space-6);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-pill);
  background: var(--paper-surface);
  font-size: var(--text-base);
  color: var(--paper-ink-2);
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.ai-status:hover {
  background: var(--paper-surface-2);
  border-color: var(--paper-line-2);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--paper-green);
  box-shadow: 0 0 0 3px var(--paper-green-soft);
}

.ai-status-idle .status-dot {
  background: var(--paper-ink-3);
  box-shadow: 0 0 0 3px var(--paper-line);
}

.ai-status-error {
  color: var(--paper-rust);
}

.ai-status-error .status-dot {
  background: var(--paper-rust);
  box-shadow: 0 0 0 3px var(--paper-rust-soft);
}

.ai-text {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .topbar {
    gap: var(--space-8);
    padding: 0 var(--space-8);
  }

  .ai-text {
    max-width: 150px;
  }
}
</style>
