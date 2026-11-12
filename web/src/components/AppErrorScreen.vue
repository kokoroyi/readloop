<script setup>
/**
 * 页面级错误边界兜底：错误编号 + 返回阅读台 + 重新加载。
 */
import Button from './ui/Button.vue'
import Icon from './ui/Icon.vue'

const props = defineProps({
  code: { type: String, default: '' },
  message: { type: String, default: '发生未预期的错误' }
})

const emit = defineEmits(['reload', 'home'])
</script>

<template>
  <div class="error-screen">
    <div class="es-card">
      <div class="es-mark"><Icon name="alert" :size="24" /></div>
      <h1 class="es-title">页面出错了</h1>
      <p class="es-text">{{ props.message }}</p>
      <p class="es-code mono">错误编号 {{ props.code }}</p>
      <p class="es-hint">可以在托盘菜单打开「查看日志」，用错误编号定位原因。</p>
      <div class="es-actions">
        <Button variant="primary" @click="emit('home')">返回阅读台</Button>
        <Button variant="secondary" @click="emit('reload')">重新加载</Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error-screen {
  min-height: calc(100vh - var(--topbar-h));
  display: grid;
  place-items: center;
  padding: var(--space-16) var(--space-12);
}

.es-card {
  width: 520px;
  max-width: 100%;
  padding: var(--space-14) var(--space-14) var(--space-11);
  border: 1px solid var(--paper-line);
  border-radius: var(--radius-xl);
  background: var(--paper-surface);
  box-shadow: var(--shadow-md);
  text-align: center;
}

.es-mark {
  width: 48px;
  height: 48px;
  margin: 0 auto var(--space-6);
  display: grid;
  place-items: center;
  border-radius: var(--radius-lg);
  background: var(--paper-rust-soft);
  color: var(--paper-rust);
}

.es-title {
  font-family: var(--font-serif);
  font-size: var(--text-7xl);
  font-weight: 700;
  line-height: var(--leading-tight);
  margin-bottom: var(--space-4);
}

.es-text {
  font-size: var(--text-lg);
  color: var(--paper-ink-2);
  line-height: var(--leading-relaxed);
}

.es-code {
  margin-top: var(--space-5);
  font-size: var(--text-base);
  color: var(--paper-ink-3);
}

.es-hint {
  margin-top: var(--space-2);
  font-size: var(--text-base);
  color: var(--paper-ink-3);
  line-height: var(--leading-relaxed);
}

.es-actions {
  margin-top: var(--space-9);
  display: flex;
  justify-content: center;
  gap: var(--space-5);
}
</style>
