<script setup>
/**
 * 词库：收藏词清单（词/音标/释义/词性/来源/收藏时间）、搜索（防抖 200ms）、
 * 排序、取消收藏、导出 CSV/JSON（原生下载）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from '../components/ui/Button.vue'
import Icon from '../components/ui/Icon.vue'
import SearchBox from '../components/ui/SearchBox.vue'
import Skeleton from '../components/ui/Skeleton.vue'
import { describeError } from '../lib/api.js'
import { downloadFile } from '../lib/download.js'
import { formatDate } from '../lib/time.js'
import {
  WORD_SORT_OPTIONS,
  loadWords,
  removeWord,
  setWordsPage,
  setWordsQuery,
  setWordsSort,
  visibleWords,
  wordsPageCount,
  wordsStore
} from '../stores/words.js'
import { toast } from '../stores/toast.js'

const searchText = ref('')
const exporting = ref('')
const removingId = ref(null)
let searchTimer = null

const loading = computed(() => wordsStore.loading)
const error = computed(() => wordsStore.error)
const empty = computed(() => !loading.value && !error.value && wordsStore.items.length === 0)
const pageCount = computed(() => wordsPageCount.value)
const sourceCount = computed(
  () =>
    new Set(
      wordsStore.items
        .map((item) => item.sourceArticleTitle)
        .filter((title) => Boolean(title))
    ).size
)
const summaryText = computed(
  () => `收藏 ${wordsStore.total} 个词 · 来自 ${sourceCount.value} 篇文章 · 仅作查询与导出，不做复习`
)

onMounted(() => {
  loadWords()
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

watch(searchText, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setWordsQuery(value), 200)
})

function retry() {
  loadWords()
}

function clearSearch() {
  searchText.value = ''
  setWordsQuery('')
}

async function exportWords(format) {
  exporting.value = format
  try {
    const name = await downloadFile(`/api/words/export?format=${format}`, {
      fallbackName: `readloop-words.${format}`
    })
    toast.success(`已导出 ${name}`)
  } catch (err) {
    toast.error(`导出失败：${describeError(err)}`)
  } finally {
    exporting.value = ''
  }
}

async function onRemove(item) {
  if (removingId.value) return
  removingId.value = item.id
  try {
    await removeWord(item.id)
    toast.success(`已取消收藏「${item.display || item.lemma}」`)
  } catch (err) {
    toast.error(`取消收藏失败：${describeError(err)}`)
  } finally {
    removingId.value = null
  }
}
</script>

<template>
  <div class="container words-page">
    <header class="page-head">
      <div>
        <h1 class="page-title">词库</h1>
        <p class="page-sub">{{ summaryText }}</p>
      </div>
      <div class="page-head-actions">
        <SearchBox v-model="searchText" placeholder="搜索词、释义或来源…" aria-label="搜索收藏词" />
        <Button :loading="exporting === 'csv'" :disabled="!wordsStore.total" @click="exportWords('csv')">
          <Icon name="download" :size="14" />
          导出 CSV
        </Button>
        <Button :loading="exporting === 'json'" :disabled="!wordsStore.total" @click="exportWords('json')">
          <Icon name="download" :size="14" />
          导出 JSON
        </Button>
      </div>
    </header>

    <section class="card words-card">
      <div class="card-head">
        <span class="card-title">收藏清单</span>
        <span class="chip chip-accent">{{ wordsStore.total }} 个词</span>
        <div class="card-head-actions">
          <div class="seg" role="group" aria-label="排序">
            <button
              v-for="option in WORD_SORT_OPTIONS"
              :key="option.value"
              type="button"
              class="seg-btn"
              :class="{ active: wordsStore.sort === option.value }"
              :aria-pressed="wordsStore.sort === option.value"
              @click="setWordsSort(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="loading" class="words-skeleton" aria-busy="true">
        <div v-for="index in 6" :key="index" class="skeleton-row">
          <Skeleton width="120px" height="17px" />
          <Skeleton width="90px" height="13px" />
          <Skeleton width="42%" height="13px" />
          <Skeleton width="180px" height="13px" />
          <Skeleton width="76px" height="13px" />
        </div>
      </div>

      <div v-else-if="error" class="words-error">
        <div class="note note-error" role="alert">
          <Icon name="alert" :size="14" />
          <span>读取词库失败：{{ describeError(error) }}</span>
        </div>
        <Button variant="primary" @click="retry">重试</Button>
      </div>

      <div v-else-if="empty" class="words-empty">
        <div class="empty-icon"><Icon name="type" :size="22" /></div>
        <h2 class="empty-title">{{ wordsStore.query ? '没有匹配的收藏词' : '还没有收藏词' }}</h2>
        <p class="empty-text">
          {{
            wordsStore.query
              ? '换个关键词试试，或清空搜索查看全部收藏词。'
              : '阅读时划选单词，在弹卡里点「收藏」即可加入词库；词库只做清单、搜索与导出。'
          }}
        </p>
        <Button v-if="wordsStore.query" @click="clearSearch">清空搜索</Button>
      </div>

      <template v-else>
        <div class="table-scroll">
          <table class="table table-fixed words-table">
            <colgroup>
              <col style="width: 168px" />
              <col style="width: 156px" />
              <col />
              <col style="width: 272px" />
              <col style="width: 116px" />
              <col style="width: 104px" />
            </colgroup>
            <thead>
              <tr>
                <th>词</th>
                <th>音标</th>
                <th>释义</th>
                <th>来源</th>
                <th>收藏时间</th>
                <th class="tbl-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in visibleWords" :key="item.id">
                <td>
                  <span class="word-display">{{ item.display || item.lemma }}</span>
                </td>
                <td><span class="word-ipa">{{ item.phonetic || '—' }}</span></td>
                <td>
                  <span class="word-def">
                    <span v-if="item.pos" class="word-pos">{{ item.pos }}</span>
                    {{ item.translation || '暂无释义' }}
                  </span>
                </td>
                <td>
                  <span class="word-source" :title="item.sourceArticleTitle || ''">
                    {{ item.sourceArticleTitle || '—' }}
                  </span>
                </td>
                <td><span class="word-date">{{ formatDate(item.createdAt) }}</span></td>
                <td class="tbl-actions">
                  <button
                    type="button"
                    class="remove-btn"
                    :disabled="removingId === item.id"
                    @click="onRemove(item)"
                  >
                    {{ removingId === item.id ? '取消中…' : '取消收藏' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card-foot words-foot">
          <span>共 {{ wordsStore.total }} 个词 · 导出将包含音标与释义</span>
          <div class="pager">
            <button
              type="button"
              class="pager-btn"
              :disabled="wordsStore.page <= 1"
              aria-label="上一页"
              @click="setWordsPage(wordsStore.page - 1)"
            >
              <Icon name="chevron-left" :size="13" />
            </button>
            <span class="pager-info mono">第 {{ wordsStore.page }} / {{ pageCount }} 页</span>
            <button
              type="button"
              class="pager-btn"
              :disabled="wordsStore.page >= pageCount"
              aria-label="下一页"
              @click="setWordsPage(wordsStore.page + 1)"
            >
              <Icon name="chevron-right" :size="13" />
            </button>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.words-page {
  padding-bottom: var(--space-16);
}

.words-card {
  overflow: hidden;
}

.words-table {
  min-width: 900px;
}

.word-display {
  font-family: var(--font-serif);
  font-size: var(--text-4xl);
  font-weight: 700;
  color: var(--paper-ink);
}

.word-ipa {
  font-size: var(--text-lg);
  color: var(--paper-ink-2);
}

.word-def {
  font-size: var(--text-xl);
  color: var(--paper-ink);
}

.word-pos {
  margin-right: var(--space-2);
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--paper-accent);
}

.word-source {
  display: block;
  font-family: var(--font-serif);
  font-size: var(--text-md);
  color: var(--paper-ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.word-date {
  font-size: var(--text-md);
  color: var(--paper-ink-2);
}

.remove-btn {
  padding: var(--space-1) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--paper-ink-2);
  font-size: var(--text-base);
  font-weight: 600;
}

.remove-btn:hover:not(:disabled) {
  background: var(--paper-rust-soft);
  color: var(--paper-rust);
}

.remove-btn:disabled {
  opacity: 0.6;
}

.words-skeleton {
  padding: var(--space-8) var(--space-11) var(--space-11);
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.words-error {
  padding: var(--space-9) var(--space-11);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-6);
}

.words-empty {
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
  margin: var(--space-4) 0 var(--space-8);
  max-width: 480px;
  font-size: var(--text-lg);
  color: var(--paper-ink-3);
  line-height: var(--leading-relaxed);
}

.words-foot {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  font-size: var(--text-base);
  color: var(--paper-ink-3);
}

.pager-info {
  font-size: var(--text-sm);
  color: var(--paper-ink-2);
}
</style>
