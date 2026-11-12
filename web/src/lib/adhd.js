/**
 * ADHD 阅读增强 v3（纯函数，可复用于阅读视图与设置页预览）：
 * - off：普通
 * - bionic：单词三段渐变（lead 加粗 / mid 同字重降透明度 / tail 更低透明度）
 * - semantic：语义加粗（基础强调=加粗，加强=更粗+轻微放大+强调色）
 * - highlight：语义高亮（基础=暖色底，加强=更深底色）
 *
 * 语义选词：停用词/数字/短词过滤 → 长度、词频倒数、大写打分 → 按密度选词，
 * 同词最多一次、相邻最小间隔（2→1→0）、最多连续 1 个 → 得分前 ~40% 作为加强层。
 */

export const ADHD_MODES = ['off', 'bionic', 'semantic', 'highlight']

export const ADHD_DEFAULT_PARAMS = Object.freeze({
  semanticDensity: 0.25,
  splitRatio: 0.35,
  leadScale: 1.12,
  letterSpacing: 0.04,
  wordSpacing: 0.1,
  baseScale: 1.08
})

export const ADHD_PARAM_RANGES = Object.freeze({
  baseScale: { min: 0.95, max: 1.15, step: 0.01 },
  letterSpacing: { min: 0, max: 0.08, step: 0.005 },
  wordSpacing: { min: 0, max: 0.25, step: 0.01 },
  semanticDensity: { min: 0.1, max: 0.6, step: 0.01 },
  splitRatio: { min: 0.25, max: 0.55, step: 0.01 },
  leadScale: { min: 1, max: 1.5, step: 0.01 }
})

/** 轻 / 中 / 重 预设（与插件观感对应的三档）。 */
export const ADHD_PRESETS = [
  {
    id: 'light',
    label: '轻',
    hint: '轻微增强，接近原生阅读',
    params: {
      baseScale: 1.02,
      letterSpacing: 0.02,
      wordSpacing: 0.04,
      semanticDensity: 0.16,
      splitRatio: 0.3,
      leadScale: 1.05
    }
  },
  {
    id: 'medium',
    label: '中',
    hint: '默认强度，兼顾速度与舒适',
    params: { ...ADHD_DEFAULT_PARAMS }
  },
  {
    id: 'heavy',
    label: '重',
    hint: '强强调，适合扫读与注意力集中',
    params: {
      baseScale: 1.12,
      letterSpacing: 0.06,
      wordSpacing: 0.16,
      semanticDensity: 0.42,
      splitRatio: 0.45,
      leadScale: 1.35
    }
  }
]

/** 常用英文停用词（自建，约 120 个）。 */
export const STOPWORDS = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves '
  ).split(/\s+/)
)

const WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

/** 归一化模式与参数（缺省/非法回退默认值）。 */
export function normalizeAdhdParams(params = {}) {
  const source = params && typeof params === 'object' ? params : {}
  const mode = ADHD_MODES.includes(source.mode) ? source.mode : 'off'
  return {
    mode,
    semanticDensity: clamp(source.semanticDensity ?? ADHD_DEFAULT_PARAMS.semanticDensity, 0.1, 0.6),
    splitRatio: clamp(source.splitRatio ?? ADHD_DEFAULT_PARAMS.splitRatio, 0.25, 0.55),
    leadScale: clamp(source.leadScale ?? ADHD_DEFAULT_PARAMS.leadScale, 1, 1.5),
    letterSpacing: clamp(source.letterSpacing ?? ADHD_DEFAULT_PARAMS.letterSpacing, 0, 0.08),
    wordSpacing: clamp(source.wordSpacing ?? ADHD_DEFAULT_PARAMS.wordSpacing, 0, 0.25),
    baseScale: clamp(source.baseScale ?? ADHD_DEFAULT_PARAMS.baseScale, 0.95, 1.15)
  }
}

/** 把句子切成词 / 空白 / 符号 token，词 token 带连续 wordIndex。 */
export function tokenizeText(text) {
  const source = String(text || '')
  const tokens = []
  const words = []
  let lastIndex = 0
  let wordIndex = 0
  WORD_PATTERN.lastIndex = 0
  let match = WORD_PATTERN.exec(source)
  while (match) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'plain', text: source.slice(lastIndex, match.index) })
    }
    const lower = match[0].toLowerCase()
    const word = {
      type: 'word',
      text: match[0],
      lower,
      letters: lower.replace(/[^a-z]/g, ''),
      wordIndex
    }
    tokens.push(word)
    words.push(word)
    wordIndex += 1
    lastIndex = WORD_PATTERN.lastIndex
    match = WORD_PATTERN.exec(source)
  }
  if (lastIndex < source.length) {
    tokens.push({ type: 'plain', text: source.slice(lastIndex) })
  }
  return { tokens, words }
}

/**
 * Bionic 三段切分：lead 字符数 = round(字母数 × ratio)，至少 1；
 * 剩余部分约 45% 为 mid（同字重、透明度更低），其余为 tail（透明度最低）。
 */
export function splitBionicWord(word, ratio = ADHD_DEFAULT_PARAMS.splitRatio) {
  const text = String(word || '')
  const letterIndexes = []
  for (let index = 0; index < text.length; index += 1) {
    if (/[A-Za-z]/.test(text[index])) letterIndexes.push(index)
  }
  const total = letterIndexes.length
  if (!total) return { lead: text, mid: '', tail: '' }
  const ratioValue = clamp(ratio, 0.25, 0.55)
  const leadLetters = Math.min(total, Math.max(1, Math.round(total * ratioValue)))
  const remaining = total - leadLetters
  const midLetters = remaining >= 2 ? Math.max(1, Math.round(remaining * 0.45)) : 0
  const leadCut = letterIndexes[leadLetters - 1] + 1
  const midCut = midLetters > 0 ? letterIndexes[leadLetters + midLetters - 1] + 1 : leadCut
  return {
    lead: text.slice(0, leadCut),
    mid: midLetters > 0 ? text.slice(leadCut, midCut) : '',
    tail: text.slice(midCut)
  }
}

function semanticCandidates(words) {
  const frequency = new Map()
  for (const word of words) frequency.set(word.lower, (frequency.get(word.lower) || 0) + 1)
  const candidates = []
  for (const word of words) {
    const letters = word.letters
    if (!letters || letters.length < 2) continue
    if (/^\d+$/.test(word.lower)) continue
    if (STOPWORDS.has(word.lower) || STOPWORDS.has(letters)) continue
    let score = 0
    if (letters.length >= 8) score += 2
    else if (letters.length >= 5) score += 1
    score += 0.6 / (frequency.get(word.lower) || 1)
    if (/^[A-Z]/.test(word.text) && word.wordIndex > 0) score += 1
    if (word.text.length > 1 && word.text === word.text.toUpperCase()) score += 1.5
    candidates.push({ wordIndex: word.wordIndex, lower: word.lower, score })
  }
  return candidates
}

/**
 * 语义选词：返回基础强调集合与加强集合（按 wordIndex）。
 * @param {string} text
 * @param {{ density?: number }} [options] density 为词数百分比（0.1–0.6）
 */
export function selectSemanticWords(text, options = {}) {
  const density = clamp(options.density ?? ADHD_DEFAULT_PARAMS.semanticDensity, 0.1, 0.6)
  const { words } = tokenizeText(text)
  const candidates = semanticCandidates(words)
  const target = Math.min(candidates.length, Math.max(1, Math.round(words.length * density)))
  const sorted = candidates.slice().sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    return left.wordIndex - right.wordIndex
  })
  const selected = new Set()
  const chosen = new Set()
  // 先要求间隔 2，再逐级放宽到 1 / 0；最多连续选 1 个、同词最多一次
  for (const gap of [2, 1, 0]) {
    for (const candidate of sorted) {
      if (selected.size >= target) break
      if (chosen.has(candidate.lower)) continue
      let conflict = false
      for (const existing of selected) {
        const distance = Math.abs(existing - candidate.wordIndex)
        if (distance <= gap || distance === 1) {
          conflict = true
          break
        }
      }
      if (conflict) continue
      selected.add(candidate.wordIndex)
      chosen.add(candidate.lower)
    }
    if (selected.size >= target) break
  }
  const amplify = new Set()
  const amplifyCount = Math.ceil(selected.size * 0.4)
  for (const candidate of sorted) {
    if (amplify.size >= amplifyCount) break
    if (selected.has(candidate.wordIndex)) amplify.add(candidate.wordIndex)
  }
  return { selected, amplify, target, wordCount: words.length, candidates }
}

/**
 * 生成可渲染 token（保留原始空白与标点，不破坏划词选择）。
 * @param {string} text
 * @param {object} params adhd 参数（含 mode）
 * @param {{ favoriteSet?: Set<string> }} [options]
 */
export function buildAdhdTokens(text, params = {}, options = {}) {
  const normalized = normalizeAdhdParams(params)
  const favoriteSet = options.favoriteSet
  const { tokens, words } = tokenizeText(text)
  let semantic = null
  if (normalized.mode === 'semantic' || normalized.mode === 'highlight') {
    semantic = selectSemanticWords(text, { density: normalized.semanticDensity })
  }
  const output = []
  let wordCursor = 0
  for (const token of tokens) {
    if (token.type !== 'word') {
      output.push({ key: output.length, type: 'plain', text: token.text })
      continue
    }
    const word = words[wordCursor]
    wordCursor += 1
    const favorite = Boolean(favoriteSet && favoriteSet.has(word.lower))
    const entry = {
      key: output.length,
      type: 'word',
      text: token.text,
      lower: word.lower,
      favorite,
      bionic: null,
      semantic: null
    }
    if (normalized.mode === 'bionic') {
      entry.bionic = splitBionicWord(token.text, normalized.splitRatio)
    } else if (semantic && semantic.selected.has(word.wordIndex)) {
      entry.semantic = semantic.amplify.has(word.wordIndex) ? 'amplify' : 'base'
    }
    output.push(entry)
  }
  return output
}

/** 兼容旧调用：返回 buildAdhdTokens 的结果。 */
export function buildSentenceTokens(text, options = {}) {
  const mode = options.adhdMode || options.mode || 'off'
  return buildAdhdTokens(text, { ...options, mode }, { favoriteSet: options.favoriteSet })
}
