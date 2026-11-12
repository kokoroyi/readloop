<script setup>
/**
 * 精读精简顶栏：返回 / 标题 / 状态 / 当前句进度 / ADHD 循环 / 外观 / 更多。
 */
import { computed } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import MenuPopover from '../ui/MenuPopover.vue'
import Tip from '../ui/Tip.vue'
import { ADHD_OPTIONS, settingsStore } from '../../stores/settings.js'

const props = defineProps({
  title: { type: String, default: '' },
  status: { type: String, default: 'reading' },
  currentIdx: { type: Number, default: 0 },
  processed: { type: Number, default: 0 },
  skipped: { type: Number, default: 0 },
  total: { type: Number, default: 0 }
})

const emit = defineEmits(['back', 'cycle-adhd', 'open-appearance', 'more'])

const STATUS_META = {
  queued: { label: '待读', className: 'chip-queued', dot: false },
  reading: { label: '精读中', className: 'chip-read', dot: true },
  recap: { label: '复盘中', className: 'chip-accent', dot: true },
  done: { label: '已复盘', className: 'chip-done', dot: false }
}

const statusMeta = computed(
  () => STATUS_META[props.status] || { label: props.status || '精读中', className: 'chip-read', dot: true }
)

const adhdMode = computed(() => settingsStore.settings.appearance.adhd.mode || 'off')
const adhdLabel = computed(
  () => ADHD_OPTIONS.find((option) => option.value === adhdMode.value)?.label || '普通'
)
const progressPercent = computed(() =>
  props.total ? Math.min(100, Math.round((props.processed / props.total) * 100)) : 0
)
const metaText = computed(() => {
  const position = `${Math.min(props.currentIdx + 1, props.total)} / ${props.total} 句`
  return `${position} · 已处理 ${props.processed} · 跳过 ${props.skipped}`
})

const moreItems = [
  { id: 'library', label: '返回文章库', icon: 'book' },
  { id: 'settings', label: '阅读外观设置', icon: 'sliders' },
  { separator: true },
  { id: 'home', label: '回到阅读台', icon: 'book-open' }
]
</script>

<template>
  <header class="read-topbar">
    <button type="button" class="icon-btn" aria-label="返回文章库" @click="emit('back')">
      <Icon name="chevron-left" :size="15" />
    </button>

    <div class="read-title-wrap">
      <h1 class="read-title" :title="props.title">{{ props.title || '精读' }}</h1>
      <span class="chip" :class="statusMeta.className">
        <span v-if="statusMeta.dot" class="chip-dot" />
        {{ statusMeta.label }}
      </span>
    </div>

    <div class="read-progress">
      <span class="read-meta mono">{{ metaText }}</span>
      <div class="progress thin"><i :style="{ width: `${progressPercent}%` }" /></div>
    </div>

    <div class="read-actions">
      <Tip content="ADHD 阅读增强：普通 / Bionic / 语义加粗 / 语义高亮；只作用于句子正文">
        <span class="action-wrap">
          <Button
            size="sm"
            variant="secondary"
            aria-label="ADHD 阅读增强"
            :data-adhd-mode="adhdMode"
            @click="emit('cycle-adhd')"
          >
            ADHD · {{ adhdLabel }}
          </Button>
        </span>
      </Tip>
      <Tip content="阅读外观：主题、字号、行距、栏宽">
        <span class="action-wrap">
          <button type="button" class="icon-btn" aria-label="阅读外观" @click="emit('open-appearance')">
            <Icon name="sliders" :size="15" />
          </button>
        </span>
      </Tip>
      <MenuPopover :items="moreItems" aria-label="更多操作" @select="(id) => emit('more', id)">
        <template #default="{ toggle }">
          <button type="button" class="icon-btn" aria-label="更多操作" @click="toggle">
            <Icon name="more" :size="16" />
          </button>
        </template>
      </MenuPopover>
    </div>
  </header>
</template>

<style scoped>
.read-topbar {
  position: sticky;
  top: 0;
  z-index: var(--z-topbar);
  display: flex;
  align-items: center;
  gap: var(--space-6);
  height: var(--topbar-h);
  flex: 0 0 var(--topbar-h);
  padding: 0 var(--space-13);
  background: var(--topbar-bg);
  border-bottom: 1px solid var(--paper-line);
  backdrop-filter: blur(10px);
}

.read-title-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  min-width: 0;
}

.read-title {
  font-family: var(--font-serif);
  font-size: var(--text-4xl);
  font-weight: 700;
  color: var(--paper-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 360px;
}

.read-progress {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 220px;
  flex: 0 0 auto;
}

.read-meta {
  font-size: var(--text-xs);
  color: var(--paper-ink-3);
  text-align: right;
}

.read-actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex: 0 0 auto;
}

.action-wrap {
  display: inline-flex;
}
</style>

