<script setup>
/** 文件导入完成态：导入篇数 + 重复跳过原因列表。 */
import Icon from '../ui/Icon.vue'

const props = defineProps({
  articles: { type: Array, default: () => [] },
  skipped: { type: Array, default: () => [] }
})

function skippedReason(item) {
  if (!item) return ''
  if (item.reason === 'DUPLICATE_CONTENT') return '内容重复，已跳过'
  return item.reason || '已跳过'
}
</script>

<template>
  <div class="done-card">
    <div class="done-icon"><Icon name="check" :size="22" /></div>
    <h3 class="done-title">已导入 {{ props.articles.length }} 篇</h3>
    <p class="done-text">文章已进入待读队列，可在文章库查看或开始精读。</p>
    <ul v-if="props.skipped.length" class="skipped-list">
      <li v-for="(item, index) in props.skipped" :key="`${index}-${item.reason}`">
        第 {{ (item.index ?? index) + 1 }} 篇：{{ skippedReason(item) }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.done-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-12);
}

.done-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-lg);
  background: var(--paper-green-soft);
  color: var(--paper-green);
}

.done-title {
  margin-top: var(--space-6);
  font-family: var(--font-serif);
  font-size: var(--text-5xl);
  font-weight: 700;
}

.done-text {
  margin-top: var(--space-4);
  font-size: var(--text-lg);
  color: var(--paper-ink-3);
}

.skipped-list {
  margin-top: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--text-base);
  color: var(--paper-ink-2);
  text-align: left;
}
</style>
