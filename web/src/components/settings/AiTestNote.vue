<script setup>
/**
 * AI 连接测试结果条：成功显示模型数与耗时，失败显示中文原因与检查建议。
 */
import Icon from '../ui/Icon.vue'

defineProps({
  result: { type: Object, default: null }
})
</script>

<template>
  <div
    v-if="result"
    class="note test-note"
    :class="result.ok ? 'note-ok' : 'note-error'"
    role="status"
  >
    <Icon :name="result.ok ? 'check' : 'alert'" :size="14" />
    <span v-if="result.ok">
      连接正常 · {{ result.mode === 'models' ? '模型列表可用' : '最小对话可用' }} · 可用模型
      {{ result.modelCount }} 个 · 平均响应 {{ result.latencyText }}
      <template v-if="result.autoSaved">（测试前已保存当前配置）</template>
      <span class="test-time">测试于 {{ result.testedAt }}</span>
    </span>
    <span v-else>
      测试连接失败：{{ result.message }}。可以检查：接口地址、API Key 与网络。
    </span>
  </div>
</template>

<style scoped>
.test-note {
  margin-top: var(--space-6);
}

.test-time {
  margin-left: var(--space-5);
  font-size: var(--text-xs);
  opacity: 0.78;
}
</style>
