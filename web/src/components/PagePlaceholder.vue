<script setup>
/**
 * 页面占位卡：M1 阶段给尚未实现的页面一个明确的"为什么空 + 下一步"。
 */
import Icon from './ui/Icon.vue'

const props = defineProps({
  icon: { type: String, default: 'book-open' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  items: { type: Array, default: () => [] },
  badge: { type: String, default: '' }
})
</script>

<template>
  <section class="card placeholder">
    <div class="ph-icon"><Icon :name="props.icon" :size="22" /></div>
    <h2 class="ph-title">{{ props.title }}</h2>
    <p v-if="props.badge" class="ph-badge">{{ props.badge }}</p>
    <p class="ph-text">{{ props.description }}</p>
    <ul v-if="props.items.length" class="ph-list">
      <li v-for="item in props.items" :key="item">{{ item }}</li>
    </ul>
  </section>
</template>

<style scoped>
.placeholder {
  padding: var(--space-14) var(--space-12);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.ph-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-lg);
  background: var(--paper-accent-soft);
  color: var(--paper-accent);
}

.ph-title {
  margin-top: var(--space-6);
  font-family: var(--font-serif);
  font-size: var(--text-5xl);
  font-weight: 700;
}

.ph-badge {
  margin-top: var(--space-3);
  padding: var(--space-1) var(--space-5);
  border-radius: var(--radius-pill);
  background: var(--paper-surface-2);
  border: 1px solid var(--paper-line);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--paper-ink-3);
}

.ph-text {
  margin-top: var(--space-4);
  max-width: 520px;
  font-size: var(--text-lg);
  color: var(--paper-ink-3);
  line-height: var(--leading-relaxed);
}

.ph-list {
  margin-top: var(--space-7);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  text-align: left;
  font-size: var(--text-base);
  color: var(--paper-ink-2);
  line-height: var(--leading-relaxed);
}

.ph-list li {
  position: relative;
  padding-left: var(--space-6);
}

.ph-list li::before {
  content: "";
  position: absolute;
  left: var(--space-2);
  top: 0.65em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--paper-accent-2);
}
</style>
