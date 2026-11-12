<script setup>
/**
 * ADHD 文本渲染：句子正文与设置页预览共用。保留原始空白/标点与可选中性，
 * 划词、收藏词虚线均不受 token 拆分影响。
 */
import { computed } from 'vue'
import { buildAdhdTokens, normalizeAdhdParams } from '../../lib/adhd.js'

const props = defineProps({
  text: { type: String, default: '' },
  mode: { type: String, default: 'off' },
  params: { type: Object, default: null },
  favorites: { type: Object, default: null }
})

const effective = computed(() =>
  normalizeAdhdParams({ ...(props.params || {}), mode: props.mode })
)

const tokens = computed(() =>
  buildAdhdTokens(props.text, effective.value, { favoriteSet: props.favorites })
)
</script>

<template>
  <span class="adhd-text" :data-adhd-mode="effective.mode">
    <template v-for="token in tokens" :key="token.key">
      <template v-if="token.type !== 'word'">{{ token.text }}</template>
      <span
        v-else-if="token.bionic"
        class="adhd-word bionic-word"
        :class="{ 'is-favorite': token.favorite }"
      >
        <span class="bionic-lead">{{ token.bionic.lead }}</span>
        <span class="bionic-mid">{{ token.bionic.mid }}</span>
        <span class="bionic-tail">{{ token.bionic.tail }}</span>
      </span>
      <span
        v-else-if="token.semantic && effective.mode === 'semantic'"
        class="adhd-word semantic-word"
        :class="[`is-${token.semantic}`, { 'is-favorite': token.favorite }]"
      >
        {{ token.text }}
      </span>
      <span
        v-else-if="token.semantic && effective.mode === 'highlight'"
        class="adhd-word highlight-word"
        :class="[`is-${token.semantic}`, { 'is-favorite': token.favorite }]"
      >
        {{ token.text }}
      </span>
      <span v-else class="adhd-word" :class="{ 'is-favorite': token.favorite }">{{ token.text }}</span>
    </template>
  </span>
</template>
