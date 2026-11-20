import type { Register } from 'claude-code'

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿ]/

export const RTL_RULE =
  'The user writes in Arabic. Reply in their language. On HTML-capable surfaces (IDE chat, artifacts, markdown preview) wrap Arabic content in <div dir="rtl"> so paragraphs, lists, punctuation and mixed Arabic-English phrases read right to left. Keep code blocks, terminal commands and file paths left to right (dir="ltr" or standard code blocks).'

export const register: Register = on => {
  // The rule stays in the conversation once added, so one injection covers
  // every later Arabic prompt until /clear starts a fresh conversation.
  let isAdded = false

  on('session.end', ($, e, next) => {
    isAdded = false
    return next(e)
  })

  // Compaction may summarize the rule away; add it again on the next Arabic prompt.
  on('session.append', { door: 'compaction' }, ($, e, next) => {
    isAdded = false
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (isAdded || !ARABIC.test(e.text)) return next(e)
    isAdded = true
    return next({ ...e, context: [...(e.context ?? []), RTL_RULE] })
  })
}
