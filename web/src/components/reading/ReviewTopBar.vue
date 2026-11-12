<script setup>
/**
 * 回顾模式顶栏：返回 / 标题 / 「回顾」状态 / 学习小结 / 重新精读 / 主题。
 */
import { computed } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import { settingsStore, toggleTheme } from '../../stores/settings.js'

const props = defineProps({
  title: { type: String, default: '' }
})

const emit = defineEmits(['back', 'summary', 'reread'])

const theme = computed(() => settingsStore.settings.appearance.theme)

async function onToggleTheme() {
  try {
    await toggleTheme()
  } catch {
    /* 主题切换失败不阻塞回顾 */
  }
}
</script>

<template>
  <header class="read-topbar review-topbar">
    <button type="button" class="icon-btn" aria-label="返回" @click="emit('back')">
      <Icon name="chevron-left" :size="16" />
    </button>
    <span class="read-title" :title="props.title">{{ props.title }}</span>
    <span class="chip chip-done review-chip"><span class="chip-dot" />回顾</span>
    <div class="read-topbar-right">
      <Button size="sm" aria-label="学习小结" @click="emit('summary')">学习小结</Button>
      <Button size="sm" variant="ghost" aria-label="重新精读" @click="emit('reread')">
        重新精读
      </Button>
      <button
        type="button"
        class="icon-btn"
        aria-label="切换主题"
        :title="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
        @click="onToggleTheme"
      >
        <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="15" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.read-title {
  font-family: var(--font-serif);
  font-size: var(--text-4xl);
  font-weight: 700;
  color: var(--paper-ink);
  max-width: 44vw;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
