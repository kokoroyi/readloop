<script setup>
/**
 * 服务不可达整页提示：重试 + 检查托盘指引。
 */
import { computed } from 'vue'
import Button from './ui/Button.vue'
import Icon from './ui/Icon.vue'

const props = defineProps({
  retrying: { type: Boolean, default: false }
})

const emit = defineEmits(['retry'])

const endpoint = computed(() => `${window.location.origin}/api/health`)
</script>

<template>
  <div class="service-down">
    <div class="sd-card">
      <div class="sd-mark"><Icon name="book" :size="24" /></div>
      <h1 class="sd-title">无法连接本地服务</h1>
      <p class="sd-text">
        ReadLoop 的数据全部存在本机，页面需要本地服务响应。它通常由托盘程序（ReadLoopTray）启动。
      </p>
      <ul class="sd-list">
        <li>确认托盘程序正在运行；若刚打开页面，请稍等 1–2 秒再重试。</li>
        <li>仍无法连接时，在托盘菜单里选择「查看日志」排查。</li>
        <li>如果服务被手动停止，请从托盘菜单选择「启动服务」。</li>
      </ul>
      <div class="sd-actions">
        <Button variant="primary" :loading="props.retrying" @click="emit('retry')">重试连接</Button>
      </div>
      <p class="sd-foot mono">探测地址 {{ endpoint }}</p>
    </div>
  </div>
</template>

<style scoped>
.service-down {
  min-height: calc(100vh - var(--topbar-h));
  display: grid;
  place-items: center;
  padding: var(--space-16) var(--space-12);
}

.sd-card {
  width: 540px;
  max-width: 100%;
  padding: var(--space-14) var(--space-14) var(--space-11);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-xl);
  background: var(--paper-surface);
  box-shadow: var(--shadow-md);
  text-align: center;
}

.sd-mark {
  width: 48px;
  height: 48px;
  margin: 0 auto var(--space-6);
  display: grid;
  place-items: center;
  border-radius: var(--radius-lg);
  background: var(--paper-accent-soft);
  color: var(--paper-accent);
}

.sd-title {
  font-family: var(--font-serif);
  font-size: var(--text-7xl);
  font-weight: 700;
  line-height: var(--leading-tight);
  margin-bottom: var(--space-4);
}

.sd-text {
  font-size: var(--text-lg);
  color: var(--paper-ink-2);
  line-height: var(--leading-relaxed);
  margin-bottom: var(--space-6);
}

.sd-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0 auto var(--space-8);
  max-width: 420px;
  text-align: left;
  font-size: var(--text-base);
  color: var(--paper-ink-3);
  line-height: var(--leading-relaxed);
}

.sd-list li {
  position: relative;
  padding-left: var(--space-6);
}

.sd-list li::before {
  content: "";
  position: absolute;
  left: var(--space-2);
  top: 0.65em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--paper-line-2);
}

.sd-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-5);
}

.sd-foot {
  margin-top: var(--space-7);
  font-size: var(--text-sm);
  color: var(--paper-ink-3);
}
</style>
