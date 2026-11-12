/**
 * Prompt 公共部分：文章前缀（03-AI-SPEC §2.2）。
 * 同一篇文章的多次调用必须逐字节一致，便于服务商前缀缓存命中。
 */

/** 文章前缀最多携带的正文字符数（超出截断并注明） */
export const MAX_ARTICLE_PREFIX_CHARS = 12000

/**
 * 构造稳定的文章前缀。
 * @param {{ title?: string, content?: string }} article
 * @returns {string}
 */
export function buildArticlePrefix(article) {
  const title = typeof article?.title === 'string' ? article.title : ''
  const rawContent = typeof article?.content === 'string' ? article.content : ''
  const content =
    rawContent.length > MAX_ARTICLE_PREFIX_CHARS
      ? `${rawContent.slice(0, MAX_ARTICLE_PREFIX_CHARS)}（文章过长，已截断后 ${MAX_ARTICLE_PREFIX_CHARS} 字符）`
      : rawContent
  return `【文章标题】${title}\n【文章全文】\n<article>\n${content}\n</article>`
}

export default buildArticlePrefix
