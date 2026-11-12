<script setup>
/**
 * 阅读台·随机回顾卡：从已复盘文章中随机抽一篇进入回顾模式（只看不调 AI）。
 */
import { computed } from 'vue'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import Tip from '../ui/Tip.vue'

const props = defineProps({
  reviewedArticles: { type: Number, default: 0 },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits(['draw'])

const disabled = computed(() => props.reviewedArticles <= 0)
</script>

<template>
  <section class="card home-card home-random" aria-label="抽一篇">
    <span class="random-icon"><Icon name="refresh" :size="17" /></span>
    <div class="random-main">
      <p class="random-title">随机回顾一篇</p>
      <p class="random-desc">
        <template v-if="disabled">还没有已复盘的文章，完成一次复盘后就能回顾。</template>
        <template v-else>从 {{ props.reviewedArticles }} 篇已复盘中抽一篇，只看不调 AI。</template>
      </p>
    </div>
    <Tip :content="disabled ? '先完成一篇复盘再来回顾' : '随机抽取一篇已复盘文章'">
      <span class="action-wrap">
        <Button
          variant="secondary"
          size="sm"
          aria-label="随机回顾"
          :disabled="disabled"
          :loading="props.loading"
          @click="emit('draw')"
        >
          抽一篇
        </Button>
      </span>
    </Tip>
  </section>
</template>
