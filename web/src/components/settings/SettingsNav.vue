<script setup>
/**
 * 设置页左侧分区导航 + 本机服务信息。
 */
import { computed } from 'vue'
import Icon from '../ui/Icon.vue'
import { settingsStore } from '../../stores/settings.js'

const props = defineProps({
  sections: { type: Array, required: true },
  active: { type: String, required: true }
})

const emit = defineEmits(['select'])

const serviceAddress = computed(() => {
  const health = settingsStore.health
  const port = (health && health.port) || window.location.port || '5178'
  return `127.0.0.1:${port}`
})

const version = computed(() => {
  const health = settingsStore.health
  return health && health.version ? `v${health.version}` : 'v0.1.0'
})
</script>

<template>
  <aside class="card side">
    <nav class="side-nav" aria-label="设置分区">
      <button
        v-for="section in props.sections"
        :key="section.id"
        type="button"
        class="side-item"
        :class="{ active: props.active === section.id }"
        :aria-current="props.active === section.id ? 'true' : undefined"
        @click="emit('select', section.id)"
      >
        <Icon :name="section.icon" :size="15" />
        <span>{{ section.label }}</span>
      </button>
    </nav>

    <div class="side-foot">
      <p class="side-foot-label">本机服务</p>
      <p class="side-foot-address mono">{{ serviceAddress }}</p>
      <p class="side-foot-version">{{ version }}</p>
    </div>
  </aside>
</template>

<style scoped>
.side {
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  min-height: 460px;
}

.side-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.side-item {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 38px;
  padding: 0 var(--space-5);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--paper-ink-2);
  font-size: var(--text-md);
  font-weight: 600;
  text-align: left;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.side-item svg {
  color: var(--paper-ink-3);
  flex: 0 0 auto;
}

.side-item:hover {
  background: var(--paper-surface-2);
  color: var(--paper-ink);
}

.side-item.active {
  background: var(--paper-accent-soft);
  color: var(--paper-accent);
}

.side-item.active svg {
  color: var(--paper-accent);
}

.side-foot {
  margin-top: auto;
  padding: var(--space-6) var(--space-5) var(--space-2);
  border-top: 1px solid var(--paper-line);
}

.side-foot-label {
  font-size: var(--text-xs);
  color: var(--paper-ink-3);
}

.side-foot-address {
  margin-top: var(--space-1);
  font-size: var(--text-sm);
  color: var(--paper-ink-2);
  word-break: break-all;
}

.side-foot-version {
  margin-top: var(--space-1);
  font-size: var(--text-2xs);
  color: var(--paper-ink-3);
}

@media (max-width: 1100px) {
  .side {
    min-height: 0;
  }
}
</style>
