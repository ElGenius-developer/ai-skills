import { test, expect } from 'claude-code/testing'

import { RTL_RULE } from '../hooks/register'

test('an Arabic prompt gets the RTL rule once, an English one never', async ($, on) => {
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', ($, e) => {
    seen.push(e.context)
    return { text: e.text, context: e.context }
  })
  const submit = (text: string) =>
    $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  await submit('fix the build')
  await submit('ازاي اعمل migration؟')
  await submit('وكمان seed')

  expect(seen[0] ?? []).not.toContain(RTL_RULE)
  expect(seen[1]).toContain(RTL_RULE)
  expect(seen[2] ?? []).not.toContain(RTL_RULE)
})
