<script setup>
/**
 * 设置页占位分区：M1 只保留入口与说明，具体参数在对应里程碑接入。
 */
import Icon from '../ui/Icon.vue'

const props = defineProps({
  title: { type: String, required: true },
  badge: { type: String, default: 'M1 占位' },
  description: { type: String, default: '' },
  items: { type: Array, default: () => [] }
})
</script>

<template>
  <section>
    <header class="section-head">
      <h2 class="section-title">{{ props.title }}</h2>
      <span v-if="props.badge" class="tag">{{ props.badge }}</span>
    </header>

    <p class="section-desc">{{ props.description }}</p>

    <ul v-if="props.items.length" class="plan-list">
      <li v-for="item in props.items" :key="item">
        <Icon name="chevron-right" :size="13" />
        <span>{{ item }}</span>
      </li>
    </ul>

    <p class="section-note">
      该分区暂未接线；M1 先确保入口、布局与设置读取链路可用，参数保存会复用同一套
      <span class="mono">PUT /api/settings</span> 分区接口。
    </p>
  </section>
</template>

<style scoped>
.section-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-5);
  margin-bottom: var(--space-6);
}

.section-title {
  font-family: var(--font-serif);
  font-size: var(--text-4xl);
  font-weight: 700;
  color: var(--paper-ink);
}

.section-desc {
  font-size: var(--text-md);
  color: var(--paper-ink-3);
  line-height: var(--leading-relaxed);
  max-width: 620px;
}

.plan-list {
  margin-top: var(--space-7);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-7) var(--space-8);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-md);
  background: var(--paper-surface-2);
}

.plan-list li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  font-size: var(--text-md);
  color: var(--paper-ink-2);
  line-height: var(--leading-relaxed);
}

.plan-list svg {
  margin-top: 3px;
  color: var(--paper-accent-2);
  flex: 0 0 auto;
}

.section-note {
  margin-top: var(--space-7);
  font-size: var(--text-base);
  color: var(--paper-ink-3);
  line-height: var(--leading-relaxed);
}

.section-note .mono {
  font-size: var(--text-sm);
  color: var(--paper-ink-2);
}
</style>
