<script setup>
/**
 * 复盘视图（C 回合卡片 + 原文浮窗）：一次一题、逐题评估、回看、跳过、自由提问、结束出小结；
 * done 状态以只读复盘记录展示，并提供「查看学习小结」。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Button from '../ui/Button.vue'
import Icon from '../ui/Icon.vue'
import RecapChat from './RecapChat.vue'
import RecapDialogs from './RecapDialogs.vue'
import RecapStatePanels from './RecapStatePanels.vue'
import RecapFooter from './RecapFooter.vue'
import RecapHeader from './RecapHeader.vue'
import OriginalFloat from './OriginalFloat.vue'
import RecapTopBar from './RecapTopBar.vue'
import TurnCard from './TurnCard.vue'
import { describeError } from '../../lib/api.js'
import { FLOAT_KEY, loadFloatWindow, saveFloatWindow } from '../../lib/floatWindow.js'
import { loadRecapSentences } from '../../lib/recapWork.js'
import {
  announceRecap,
  answeredCount,
  currentNumber,
  currentQuestion,
  finishConfirmDescription,
  finishRecap,
  isFinished,
  lastAnsweredId,
  loadRecap,
  progressDots,
  recapDurationText,
  recapStore,
  reloadRecap,
  skipQuestion,
  skippedCount,
  startRecap,
  submitAnswer
} from '../../stores/recap.js'
import { settingsStore, toggleTheme } from '../../stores/settings.js'
import { toast } from '../../stores/toast.js'

const props = defineProps({
  articleId: { type: [Number, String], required: true },
  article: { type: Object, default: null },
  readonly: { type: Boolean, default: false }
})

const router = useRouter()

const sentences = ref([])
const expandedIds = reactive(new Set())
const autoFocusId = ref(null)
const skipState = reactive({ open: false, id: null, loading: false })
const endOpen = ref(false)

function hasSavedLayout() {
  try {
    return localStorage.getItem(FLOAT_KEY) !== null
  } catch {
    return false
  }
}

const savedLayout = loadFloatWindow()
const floatOpen = ref(
  hasSavedLayout() ? savedLayout.open : Boolean(settingsStore.settings.recap.floatWindowDefaultOpen)
)

const showReference = computed(() => Boolean(settingsStore.settings.recap.showReference))
const readonlyMode = computed(() => props.readonly || isFinished.value)
const articleTitle = computed(
  () => (props.article && props.article.title) || (recapStore.recap && recapStore.recap.title) || '复盘'
)
const sentenceMap = computed(() =>
  Object.fromEntries(
    sentences.value.map((sentence) => [
      sentence.idx,
      {
        text: sentence.text,
        myTranslation: sentence.myTranslation,
        referenceTranslation: sentence.referenceTranslation
      }
    ])
  )
)
const floatSentences = computed(() => sentences.value.map((sentence) => ({ idx: sentence.idx, text: sentence.text })))
const currentRefs = computed(() => (currentQuestion.value ? currentQuestion.value.sentenceRefs : []))
const questionIndexMap = computed(() => new Map(recapStore.questions.map((question, index) => [question.id, index])))

function answerFor(questionId) {
  return recapStore.answers.find((answer) => answer.questionId === questionId) || null
}

const turns = computed(() => {
  const list = []
  if (readonlyMode.value) {
    for (const [index, question] of recapStore.questions.entries()) {
      list.push({ question, index, answer: answerFor(question.id), isCurrent: false })
    }
    return list
  }
  for (const question of recapStore.questions) {
    const answer = answerFor(question.id)
    if (!answer) continue
    const index = questionIndexMap.value.get(question.id)
    if (index === undefined) continue
    list.push({ question, index, answer, isCurrent: false })
  }
  list.sort((a, b) => a.index - b.index)
  const current = currentQuestion.value
  if (current) {
    const index = questionIndexMap.value.get(current.id)
    list.push({ question: current, index: index === undefined ? list.length : index, answer: null, isCurrent: true })
  }
  return list
})

function scrollToTurn(questionId) {
  nextTick(() => {
    const el = document.querySelector(`[data-turn-id="${questionId}"]`)
    if (!el) return
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  })
}

async function loadAll() {
  const [rows] = await Promise.all([loadRecapSentences(props.articleId), loadRecap(props.articleId)])
  sentences.value = rows
  expandedIds.clear()
  if (readonlyMode.value) return
  const current = currentQuestion.value
  if (current) {
    expandedIds.add(current.id)
    autoFocusId.value = current.id
  }
}

onMounted(loadAll)

watch(
  () => props.articleId,
  () => loadAll()
)

onBeforeUnmount(() => {
  recapStore.answerError = null
})

function onToggle(questionId) {
  if (expandedIds.has(questionId)) expandedIds.delete(questionId)
  else expandedIds.add(questionId)
}

async function onSubmit(questionId, text) {
  const result = await submitAnswer(questionId, text)
  if (!result.ok) {
    if (result.error && result.error.conflict) toast.info('这道题已经作答过了，已刷新记录')
    return
  }
  expandedIds.add(questionId)
  if (result.degraded) toast.info('点评生成失败，回答已保留；可以重试点评或进入下一题')
  else toast.success('点评完成')
  scrollToTurn(questionId)
}

async function onRetry(questionId) {
  const answer = answerFor(questionId)
  if (!answer) return
  const result = await submitAnswer(questionId, answer.answer)
  if (result.ok) {
    if (result.degraded) toast.info('点评仍未生成，可以继续下一题')
    else toast.success('点评完成')
  } else if (result.error && result.error.conflict) {
    await reloadRecap()
    toast.info('该题已记录，不能重复点评')
  } else {
    toast.error('重试点评失败，请稍后再试')
  }
}

function onNext(questionId) {
  expandedIds.delete(questionId)
  nextTick(() => {
    const next = currentQuestion.value
    if (!next) return
    expandedIds.add(next.id)
    autoFocusId.value = next.id
    scrollToTurn(next.id)
  })
}

function requestSkip(questionId) {
  skipState.id = questionId
  skipState.open = true
}

async function confirmSkip() {
  const id = skipState.id
  if (id == null) return
  skipState.loading = true
  try {
    const result = await skipQuestion(id)
    if (result.ok) {
      expandedIds.delete(id)
      skipState.open = false
      nextTick(() => scrollToTurn(currentQuestion.value ? currentQuestion.value.id : id))
    } else {
      toast.error('跳过失败，请重试')
    }
  } finally {
    skipState.loading = false
  }
}

function requestFinish() {
  if (recapStore.finishing) return
  endOpen.value = true
}

async function confirmFinish() {
  const result = await finishRecap()
  if (result.ok) {
    endOpen.value = false
    if (result.summary && result.summary.degraded) toast.info('AI 小结已生成简版')
    router.push(`/read/${props.articleId}/summary`)
  } else {
    endOpen.value = false
    toast.error('生成学习小结失败，可点击重试')
  }
}

async function retryFinish() {
  endOpen.value = true
}

async function retryStartRecap() {
  try {
    await startRecap(props.articleId)
    await loadRecap(props.articleId)
  } catch (err) {
    toast.error(`重新出题失败：${describeError(err)}`)
  }
}

function onDotClick(dot) {
  if (dot.state === 'todo') return
  if (dot.state === 'answered' || dot.state === 'skipped') expandedIds.add(dot.id)
  scrollToTurn(dot.id)
}

function back() {
  router.push('/library')
}

function openSummary() {
  router.push(`/read/${props.articleId}/summary`)
}

async function onToggleTheme() {
  try {
    await toggleTheme()
  } catch (err) {
    toast.error(`切换主题失败：${describeError(err)}`)
  }
}

function toggleFloat() {
  floatOpen.value = !floatOpen.value
  saveFloatWindow({ ...loadFloatWindow(), open: floatOpen.value })
}

function onFloatOpenChange(open) {
  floatOpen.value = open
  saveFloatWindow({ ...loadFloatWindow(), open })
}
</script>

<template>
  <div class="recap-shell">
    <RecapTopBar
      :title="articleTitle"
      :status="readonlyMode ? 'finished' : recapStore.status"
      :number="readonlyMode ? answeredCount : currentNumber"
      :total="recapStore.total"
      :finishing="recapStore.finishing"
      :readonly="readonlyMode"
      :float-open="floatOpen"
      :can-skip="Boolean(currentQuestion) && !readonlyMode"
      @skip="requestSkip(currentQuestion.id)"
      @back="back"
      @finish="requestFinish"
      @summary="openSummary"
      @toggle-float="toggleFloat"
      @toggle-theme="onToggleTheme"
    />

    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ recapStore.liveMessage }}</p>

    <div class="recap-wrap">
      <RecapStatePanels
        v-if="recapStore.loading || recapStore.notFound || recapStore.error"
        :loading="recapStore.loading"
        :not-found="recapStore.notFound"
        :error="recapStore.error"
        @retry="loadRecap(props.articleId)"
        @back="back"
        @restart="retryStartRecap"
      />

      <template v-else>
        <RecapHeader
          :title="articleTitle"
          :total="recapStore.total"
          :answered="answeredCount"
          :skipped="skippedCount"
          :duration-text="recapDurationText"
          :dots="progressDots"
          @dot-click="onDotClick"
        />

        <div v-if="recapStore.degraded" class="note note-warn recap-banner" role="note">
          <Icon name="alert" :size="14" />
          <span>题目已降级为通用题（AI 输出异常），不影响作答与生成小结。</span>
        </div>
        <div v-if="recapStore.finishError" class="note note-error recap-banner" role="alert">
          <Icon name="alert" :size="14" />
          <span>生成学习小结失败：{{ recapStore.finishError.message }}。可以重试。</span>
          <Button size="sm" variant="secondary" @click="retryFinish">重试</Button>
        </div>

        <div v-if="turns.length" class="turns">
          <TurnCard
            v-for="turn in turns"
            :key="turn.question.id"
            :data-turn-id="turn.question.id"
            :question="turn.question"
            :index="turn.index"
            :total="recapStore.total"
            :answer="turn.answer"
            :is-current="turn.isCurrent"
            :readonly="readonlyMode"
            :expanded="expandedIds.has(turn.question.id)"
            :submitting="recapStore.answeringQuestionId === turn.question.id"
            :show-reference="showReference"
            :sentence-map="sentenceMap"
            :answer-error="recapStore.answerError"
            :show-next="!readonlyMode && turn.question.id === lastAnsweredId && Boolean(currentQuestion)"
            :auto-focus="!readonlyMode && autoFocusId === turn.question.id"
            @submit="onSubmit(turn.question.id, $event)"
            @skip="requestSkip(turn.question.id)"
            @next="onNext(turn.question.id)"
            @toggle="onToggle(turn.question.id)"
            @retry="onRetry(turn.question.id)"
          />
        </div>
        <div v-else class="card recap-empty">还没有复盘题目；可以回到文章库重新进入复盘。</div>

        <div v-if="!readonlyMode && !currentQuestion" class="note note-info recap-banner">
          <Icon name="check" :size="14" />
          <span>所有题目都已处理，可以结束并生成学习小结。</span>
        </div>

        <RecapChat
          :article-id="props.articleId"
          :disabled="readonlyMode"
          @announce="announceRecap"
        />

        <RecapFooter
          :readonly="readonlyMode"
          :finishing="recapStore.finishing"
          @finish="requestFinish"
        />
      </template>
    </div>

    <OriginalFloat
      v-if="!recapStore.loading"
      :title="articleTitle"
      :sentences="floatSentences"
      :refs="currentRefs"
      :open="floatOpen"
      @update:open="onFloatOpenChange"
    />

    <RecapDialogs
      v-model:end-open="endOpen"
      v-model:skip-open="skipState.open"
      :skip-loading="skipState.loading"
      :end-loading="recapStore.finishing"
      :end-description="finishConfirmDescription"
      @confirm-skip="confirmSkip"
      @confirm-end="confirmFinish"
    />
  </div>
</template>
