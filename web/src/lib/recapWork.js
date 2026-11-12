/**
 * 复盘/小结共用的逐句数据加载：GET work，平铺出原句、我的译文、参考译文（失败返回空数组）。
 */

import { get } from './api.js'
import { normalizeCorrection } from './work.js'

export async function loadRecapSentences(articleId) {
  try {
    const data = await get(`/api/articles/${articleId}/work`, { timeoutMs: 30000 })
    return (Array.isArray(data.sentences) ? data.sentences : []).map((sentence) => {
      const work = sentence.work || {}
      const correction = normalizeCorrection(work.correction)
      return {
        idx: Number(sentence.idx),
        text: typeof sentence.text === 'string' ? sentence.text : '',
        myTranslation: typeof work.myTranslation === 'string' ? work.myTranslation : '',
        referenceTranslation: correction ? correction.referenceTranslation : ''
      }
    })
  } catch {
    return []
  }
}
