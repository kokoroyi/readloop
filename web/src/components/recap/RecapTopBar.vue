<script setup>
/**
 * 复盘顶栏：返回 / 标题 / 状态（复盘中·已复盘）/ 第 n / N 题 / 原文浮窗 / 结束并生成小结（或查看小结）。
 */
import { computed } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import { THEME_OPTIONS, settingsStore } from '../../stores/settings.js'

const props = defineProps({
  title: { type: String, default: '' },
  status: { type: String, default: 'asking' },
  number: { type: Number, default: 1 },
  total: { type: Number, default: 0 },
  finishing: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  floatOpen: { type: Boolean, default: true },
  canSkip: { type: Boolean, default: false }
})

const emit = defineEmits(['back', 'finish', 'toggle-float', 'toggle-theme', 'summary', 'skip'])

const isFinished = computed(() => props.status === 'finished' || props.readonly)
const theme = computed(() => settingsStore.settings.appearance.theme)
const themeLabel = computed(() => {
  const option = THEME_OPTIONS.find((item) => item.value === theme.value)
  return theme.value === 'dark' ? '切换到浅色主题' : `切换到${option ? option.label : '浅色'}`
})
</script>

<template>
  <header class="read-topbar recap-topbar">
    <button type="button" class="icon-btn" aria-label="返回文章库" @click="emit('back')">
      <Icon name="chevron-left" :size="16" />
    </button>
    <span class="read-title" :title="props.title">{{ props.title }}</span>
    <span class="chip" :class="isFinished ? 'chip-done' : 'chip-accent'">
      <span class="chip-dot" />{{ isFinished ? '已复盘' : '复盘中' }}
    </span>

    <div class="read-topbar-right">
      <span class="recap-count">
        <template v-if="isFinished">已答 {{ props.number }} / {{ props.total }} 题</template>
        <template v-else>第 <b>{{ props.number }}</b> / {{ props.total }} 题</template>
      </span>
      <Button
        v-if="props.canSkip && !isFinished"
        size="sm"
        variant="ghost"
        aria-label="跳过本题"
        @click="emit('skip')"
      >
        跳过本题
      </Button>
      <Button
        size="sm"
        variant="ghost"
        :aria-label="props.floatOpen ? '收起原文浮窗' : '原文浮窗'"
        :aria-pressed="props.floatOpen"
        @click="emit('toggle-float')"
      >
        <Icon name="book-open" :size="14" />
        {{ props.floatOpen ? '收起原文' : '原文' }}
      </Button>
      <Button
        v-if="!isFinished"
        size="sm"
        :loading="props.finishing"
        aria-label="结束并生成小结"
        @click="emit('finish')"
      >
        结束并生成小结
      </Button>
      <Button v-else size="sm" aria-label="查看学习小结" @click="emit('summary')">查看学习小结</Button>
      <button
        type="button"
        class="icon-btn"
        aria-label="切换主题"
        :title="themeLabel"
        @click="emit('toggle-theme')"
      >
        <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="15" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.recap-topbar {
  gap: var(--space-5);
}

.read-topbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.read-title {
  font-family: var(--font-serif);
  font-size: var(--text-4xl);
  font-weight: 700;
  color: var(--paper-ink);
  max-width: 40vw;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recap-count {
  font-size: var(--text-base);
  color: var(--paper-ink-2);
  white-space: nowrap;
}

.recap-count b {
  color: var(--paper-ink);
}
</style>


