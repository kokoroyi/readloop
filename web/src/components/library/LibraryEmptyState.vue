<script setup>
/** 文章库空态：区分「搜索无结果 / 筛选无文章 / 空库」三种文案与下一步动作。 */
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'

const props = defineProps({
  query: { type: String, default: '' },
  status: { type: String, default: 'all' }
})

const emit = defineEmits(['clear-search', 'show-all', 'import'])
</script>

<template>
  <div class="lib-empty">
    <div class="empty-icon"><Icon name="file-text" :size="22" /></div>
    <h2 class="empty-title">
      {{
        props.query
          ? '没有匹配的文章'
          : props.status !== 'all'
            ? '当前筛选下没有文章'
            : '文章库还没有内容'
      }}
    </h2>
    <p class="empty-text">
      {{
        props.query
          ? '换个关键词试试，或清空搜索查看全部文章。'
          : props.status !== 'all'
            ? '可以切换到「全部」，或导入新的文章。'
            : '粘贴一段英文，或导入 .txt / .md 文件；导入后会进入待读队列。'
      }}
    </p>
    <div class="empty-actions">
      <Button v-if="props.query" @click="emit('clear-search')">清空搜索</Button>
      <Button v-else-if="props.status !== 'all'" @click="emit('show-all')">查看全部</Button>
      <Button v-if="!props.query" variant="primary" @click="emit('import')">
        <Icon name="upload" :size="15" />
        导入文章
      </Button>
    </div>
  </div>
</template>

<style scoped>
.lib-empty {
  padding: var(--space-16) var(--space-12);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.empty-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-lg);
  background: var(--paper-accent-soft);
  color: var(--paper-accent);
}

.empty-title {
  margin-top: var(--space-6);
  font-family: var(--font-serif);
  font-size: var(--text-5xl);
  font-weight: 700;
}

.empty-text {
  margin-top: var(--space-4);
  max-width: 480px;
  font-size: var(--text-lg);
  line-height: var(--leading-relaxed);
  color: var(--paper-ink-3);
}

.empty-actions {
  margin-top: var(--space-8);
  display: flex;
  gap: var(--space-5);
}
</style>
