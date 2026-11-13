/**
 * Pure, deterministic conversation distillation.
 *
 * A digest is derived from one stored Session log only: no network, no model
 * call, no mutation. Everything the model later sees as "advice" is a rule over
 * observable signals (user corrections, aborted turns, tool errors, oversized
 * tool output, injected context, compaction), so a digest can be recomputed at
 * any time and compared across sessions.
 */

/** Bump when digest fields or rule semantics change; stale caches are rebuilt. */
export const DIGEST_VERSION = 5

const LONG_TOOL_RESULT = 12000
const HUGE_TOOL_RESULT = 60000
const LONG_SESSION_EVENTS = 600

const CORRECTION_RE =
  /(不对|不是这样|不是这个|错了|搞错|重新|再改|改成|应该用|别用|不要用|回退|撤销|actually|that's not|that is not|wrong|instead|revert|undo)/iu

const CONSTRAINT_RE = /(必须|只能|不要|不得|不能|限制|不超过|至少|must|should|only|do not|don't|limit)/iu
const ACCEPTANCE_RE = /(验收|测试|自测|通过标准|完成标准|检查|验证|acceptance|test|verify|criteria)/iu
const FORMAT_RE = /(输出|格式|json|markdown|表格|列表|分点|format|table|bullet)/iu
const PATH_RE = /([A-Za-z]:\\[^\s"'`]+|\/[\w.-]+\/[\w./-]+|[A-Za-z0-9_-]+\.(ts|tsx|js|jsx|json|md|py|go|rs|css|html|yml|yaml))/u

const TOOL_ARG_PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path', 'cwd', 'target']

/**
 * Flatten message content blocks into plain text.
 * @param content - a message `content` value of unknown shape.
 * @returns newline-joined text of the text blocks.
 */
export function blocksToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'reasoning' && typeof block.text === 'string') continue
  }
  return parts.join('\n')
}

/**
 * Shorten text for one digest field.
 * @param text - source text.
 * @param max - maximum length.
 * @returns trimmed text, with an ellipsis when truncated.
 */
export function clip(text, max) {
  const flat = String(text ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1).trimEnd()}…`
}

/** One line of prose for a tool call: `read(D:\a\b.ts)`. */
function callLine(call) {
  const target = call.target ?? ''
  const base = target === '' ? call.name : `${call.name}(${target})`
  const suffix = call.error === true ? ' ✗' : ''
  return clip(`${base}${suffix}`, 90)
}

function readTarget(argsText) {
  if (typeof argsText !== 'string' || argsText === '') return {}
  try {
    const args = JSON.parse(argsText)
    if (!args || typeof args !== 'object') return {}
    for (const key of TOOL_ARG_PATH_KEYS) {
      const value = args[key]
      if (typeof value === 'string' && value.trim() !== '') {
        const clean = value.trim()
        return { display: clip(clean, 70), path: /\.\w{1,8}$/u.test(clean) ? clean : undefined }
      }
    }
    if (typeof args.command === 'string') return { display: clip(args.command, 60) }
    if (typeof args.name === 'string') return { display: clip(args.name, 50) }
    return {}
  } catch {
    return {}
  }
}

function pushUnique(list, item) {
  if (!list.some((existing) => existing.kind === item.kind)) list.push(item)
}

/**
 * Fold one Session log snapshot into a digest entry.
 * @param snapshot - `{ session, events }` from `sessionQuery.readSession`.
 * @param title - latest folded Session title, when the corpus has one.
 * @returns a JSON-serializable digest entry (no model output attached yet).
 */
export function analyzeSession(snapshot, title) {
  const header = snapshot.session ?? {}
  const events = Array.isArray(snapshot.events) ? snapshot.events : []

  const userTexts = []
  const assistantTexts = []
  const turnEnds = []
  const toolCalls = new Map()
  const callById = new Map()
  const steps = []
  const files = new Set()
  let toolCallCount = 0
  let toolErrorCount = 0
  let toolResultChars = 0
  let largestToolResult = 0
  let injectedMessages = 0
  let compactions = 0
  let inputTokens = 0
  let outputTokens = 0
  let interruptedMessages = 0
  let lastTime = header.createdAt ?? 0

  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    if (typeof event.time === 'number') lastTime = Math.max(lastTime, event.time)
    const data = event.data ?? {}
    switch (event.type) {
      case 'user/message': {
        const source = data.source?.kind
        if (source !== undefined && source !== 'user') break
        const text = blocksToText(data.content).trim()
        if (text !== '') userTexts.push(text)
        break
      }
      case 'assistant/message': {
        if (data.interrupted === true) interruptedMessages += 1
        const usage = data.usage
        if (usage && typeof usage === 'object') {
          if (typeof usage.inputTokens === 'number') inputTokens += usage.inputTokens
          if (typeof usage.outputTokens === 'number') outputTokens += usage.outputTokens
        }
        const text = blocksToText(data.message?.content).trim()
        if (text !== '') assistantTexts.push(text)
        break
      }
      case 'tool/call': {
        toolCallCount += 1
        const id = String(data.callId ?? `call-${toolCallCount}`)
        const name = typeof data.name === 'string' ? data.name : 'unknown'
        const args = typeof data.arguments === 'string' ? data.arguments : ''
        const parsed = readTarget(args)
        if (typeof parsed.path === 'string') files.add(parsed.path)
        const stat = toolCalls.get(name) ?? { name, calls: 0, errors: 0 }
        stat.calls += 1
        toolCalls.set(name, stat)
        const call = { id, name, target: parsed.display, error: false }
        callById.set(id, call)
        steps.push(call)
        if (steps.length > 40) steps.shift()
        break
      }
      case 'tool/result': {
        const message = data.message ?? {}
        const text = blocksToText(message.content)
        const chars = text.length
        toolResultChars += chars
        largestToolResult = Math.max(largestToolResult, chars)
        const failed = data.error !== undefined || message.isError === true
        const resultCallId = String(message.toolCallId ?? message.source?.callId ?? data.callId ?? '')
        const resultCall = resultCallId === '' ? undefined : callById.get(resultCallId)
        if (failed) {
          toolErrorCount += 1
          const name = typeof data.name === 'string' ? data.name : resultCall?.name
          if (name !== undefined) {
            const stat = toolCalls.get(name) ?? { name, calls: 0, errors: 0 }
            stat.errors += 1
            toolCalls.set(name, stat)
          }
          if (resultCall !== undefined) resultCall.error = true
        }
        break
      }
      case 'turn/end': {
        const reason = data.reason?.kind ?? 'unknown'
        turnEnds.push(reason)
        break
      }
      case 'system/message':
      case 'developer/message': {
        injectedMessages += 1
        break
      }
      case 'compaction/summary':
      case 'compaction/replace':
      case 'compaction/start':
      case 'compaction/end':
      case 'compaction/commit': {
        compactions += 1
        break
      }
      default: {
        if (typeof event.type === 'string' && event.type.startsWith('compaction/')) compactions += 1
      }
    }
  }

  const turns = turnEnds.length
  const abortedTurns = turnEnds.filter((kind) => kind === 'aborted' || kind === 'interrupted').length
  const erroredTurns = turnEnds.filter((kind) => kind === 'error' || kind === 'max-tokens').length
  const firstUser = userTexts.find((text) => !text.startsWith('/')) ?? userTexts[0] ?? ''
  const lastUser = [...userTexts].reverse().find((text) => !text.startsWith('/')) ?? ''
  const outcome = assistantTexts.length === 0 ? '' : assistantTexts[assistantTexts.length - 1]
  const corrections = userTexts
    .slice(1)
    .filter((text) => CORRECTION_RE.test(text)).length
  const errorRate = toolCallCount === 0 ? 0 : toolErrorCount / toolCallCount
  const contextBloat = toolResultChars >= LONG_TOOL_RESULT * 10 || largestToolResult >= HUGE_TOOL_RESULT
  const compacted = compactions > 0
  const longSession = events.length >= LONG_SESSION_EVENTS
  const noOutcome = outcome.trim() === ''

  let score = 100
  score -= abortedTurns * 8
  score -= erroredTurns * 6
  score -= Math.min(24, corrections * 6)
  score -= Math.round(errorRate * 30)
  score -= compacted ? 6 : 0
  score -= contextBloat ? 6 : 0
  score -= noOutcome ? 20 : 0
  score -= longSession ? 4 : 0
  if (turns <= 2 && corrections === 0 && abortedTurns === 0) score += 6
  score = Math.max(0, Math.min(100, score))

  const flags = []
  if (corrections > 0) flags.push('user-corrections')
  if (abortedTurns > 0) flags.push('aborted-turns')
  if (toolErrorCount > 0) flags.push('tool-errors')
  if (contextBloat) flags.push('context-bloat')
  if (compacted) flags.push('compacted')
  if (noOutcome) flags.push('no-outcome')
  if (longSession) flags.push('long-session')

  const lessons = []
  const promptAdvice = []
  const contextAdvice = []

  if (firstUser !== '' && firstUser.length < 40 && turns > 2) {
    pushUnique(promptAdvice, {
      kind: 'short-opening',
      text: '开场需求过短：用目标、范围、约束、验收标准四段式开头，可以减少后续来回确认。',
    })
  }
  if (corrections > 0) {
    pushUnique(promptAdvice, {
      kind: 'corrections',
      text: `用户中途纠正了 ${corrections} 次：首轮把验收标准和不可改动的部分写清楚，能避免大部分返工。`,
    })
  }
  if (abortedTurns > 0) {
    pushUnique(promptAdvice, {
      kind: 'aborted',
      text: `有 ${abortedTurns} 个回合被中止：先确认范围与做法，再让代理执行，比一次性大改更稳。`,
    })
  }
  if (noOutcome && turns > 0) {
    pushUnique(promptAdvice, {
      kind: 'no-outcome',
      text: '会话没有留下最终结论：要求「最后给出结论、改动清单和验证结果」，方便下次直接复用。',
    })
  }
  if (longSession) {
    pushUnique(promptAdvice, {
      kind: 'long-session',
      text: `会话偏长（${events.length} 个事件）：把任务拆成阶段目标，每阶段结束先总结再继续。`,
    })
  }
  if (toolErrorCount > 0) {
    const worst = [...toolCalls.values()].filter((stat) => stat.errors > 0).sort((a, b) => b.errors - a.errors)[0]
    pushUnique(contextAdvice, {
      kind: 'tool-errors',
      text:
        worst === undefined
          ? `工具调用失败 ${toolErrorCount} 次：先确认路径、参数和环境假设，再重试。`
          : `工具失败集中在 ${worst.name}（${worst.errors}/${worst.calls}）：调用前先确认参数与环境，减少无效尝试。`,
    })
  }
  if (largestToolResult >= LONG_TOOL_RESULT) {
    pushUnique(contextAdvice, {
      kind: 'tool-output',
      text: `单次工具输出最大 ${largestToolResult} 字符：用过滤、分页或直接定位替代整段读取，能显著降低上下文压力。`,
    })
  }
  if (injectedMessages > 0 && injectedMessages >= Math.max(3, userTexts.length)) {
    pushUnique(contextAdvice, {
      kind: 'injected',
      text: `注入了 ${injectedMessages} 条系统/开发者上下文：定期清理不再需要的注入内容，避免挤占有效信息。`,
    })
  }
  if (compacted) {
    pushUnique(contextAdvice, {
      kind: 'compacted',
      text: `发生了 ${compactions} 次上下文压缩：任务边界过大，建议阶段性总结后另起会话。`,
    })
  }

  if (corrections === 0 && abortedTurns === 0 && turns > 0 && turns <= 3) {
    lessons.push({ kind: 'fast-convergence', text: '一次成型：需求描述与执行结果都对上了，可作为同类任务的提示词模板。' })
  }
  if (toolErrorCount === 0 && toolCallCount > 3) {
    lessons.push({ kind: 'clean-tools', text: `工具零失败（${toolCallCount} 次调用）：参数与环境假设可靠，值得复用这套调用顺序。` })
  }
  if (outcome !== '') {
    const shape = steps.slice(-4).map(callLine).join(' → ')
    lessons.push({
      kind: 'recipe',
      text: shape === '' ? '形成了可复用的完成结果。' : `可复用的完成路径：${shape}`,
    })
  }
  if (compacted || longSession) {
    lessons.push({ kind: 'split', text: '长会话适合拆分为多个短会话，并在每个会话开头附上上一阶段的结论摘要。' })
  }

  return {
    id: String(header.id ?? ''),
    title: typeof title === 'string' && title.trim() !== '' ? clip(title, 120) : clip(firstUser, 80) || 'Untitled conversation',
    createdAt: header.createdAt ?? 0,
    updatedAt: lastTime,
    cwd: typeof header.cwd === 'string' ? header.cwd : '',
    agentPreset: typeof header.agentPreset === 'string' ? header.agentPreset : '',
    stats: {
      events: events.length,
      turns,
      userMessages: userTexts.length,
      assistantMessages: assistantTexts.length,
      toolCalls: toolCallCount,
      toolErrors: toolErrorCount,
      injectedMessages,
      compactions,
      abortedTurns,
      erroredTurns,
      interruptedMessages,
      toolResultChars,
      largestToolResult,
      inputTokens,
      outputTokens,
      durationMs: Math.max(0, lastTime - (header.createdAt ?? lastTime)),
    },
    tools: [...toolCalls.values()].sort((a, b) => b.calls - a.calls).slice(0, 12),
    files: [...files].slice(0, 12),
    corrections,
    flags,
    score,
    goal: clip(firstUser, 400),
    lastUser: clip(lastUser, 400),
    outcome: clip(outcome, 700),
    keySteps: steps.slice(-8).map(callLine),
    lessons,
    promptAdvice,
    contextAdvice,
    digestVersion: DIGEST_VERSION,
    source: 'rules',
    digestedAt: Date.now(),
  }
}

/**
 * Build the model-readable transcript used by deep distillation.
 * @param snapshot - `{ session, events }` from `sessionQuery.readSession`.
 * @param limit - maximum characters of the transcript.
 * @returns a compact transcript with head and tail preserved.
 */
export function buildTranscript(snapshot, limit = 16000) {
  const lines = []
  const events = Array.isArray(snapshot.events) ? snapshot.events : []
  let index = 0
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const data = event.data ?? {}
    if (event.type === 'user/message') {
      const source = data.source?.kind
      if (source !== undefined && source !== 'user') continue
      const text = blocksToText(data.content).trim()
      if (text === '') continue
      index += 1
      lines.push(`【用户 ${index}】${clip(text, 1200)}`)
    } else if (event.type === 'assistant/message') {
      const text = blocksToText(data.message?.content).trim()
      if (text === '') continue
      lines.push(`【助手】${clip(text, 900)}`)
    } else if (event.type === 'tool/call') {
      const name = typeof data.name === 'string' ? data.name : '工具'
      lines.push(`【调用】${name} ${clip(String(data.arguments ?? ''), 200)}`)
    } else if (event.type === 'tool/result' && data.error !== undefined) {
      lines.push(`【工具失败】${clip(blocksToText(data.message?.content), 300)}`)
    } else if (event.type === 'turn/end') {
      lines.push(`【回合结束】${data.reason?.kind ?? 'unknown'}`)
    }
  }
  const whole = lines.join('\n')
  if (whole.length <= limit) return whole
  const head = Math.floor(limit * 0.55)
  const tail = limit - head
  return `${whole.slice(0, head)}\n\n…（中间内容已省略）…\n\n${whole.slice(whole.length - tail)}`
}

const LESSON_LABELS = {
  'fast-convergence': '一次成型：需求与结果对齐，可直接复用这类提示词',
  'clean-tools': '工具零失败：参数与环境假设可靠，值得复用调用顺序',
  recipe: '形成了可复用的完成路径',
  split: '长会话适合拆分，并在开头附上一阶段结论',
}

const PROMPT_LABELS = {
  'short-opening': '开场需求过短：用目标 / 范围 / 约束 / 验收四段式',
  corrections: '用户中途纠正：首轮写清验收标准与不可改动的部分',
  aborted: '回合被中止：先确认范围与做法，再执行',
  'no-outcome': '缺少最终结论：要求给出结论、改动清单与验证结果',
  'long-session': '会话偏长：拆成阶段目标，每阶段结束先总结',
}

const CONTEXT_LABELS = {
  'tool-errors': '工具失败：调用前确认路径、参数与环境假设',
  'tool-output': '单次工具输出过大：用过滤、分页或定位替代整段读取',
  injected: '注入上下文过多：清理不再需要的系统 / 开发者注入',
  compacted: '发生上下文压缩：任务边界过大，建议拆分会话',
}

/**
 * Aggregate cross-conversation advice.
 * @param entries - digest entries.
 * @returns counts and the most repeated lessons and advice.
 */
export function aggregateAdvice(entries) {
  const list = Object.values(entries ?? {})
  const lessons = new Map()
  const promptAdvice = new Map()
  const contextAdvice = new Map()
  const tools = new Map()
  let totalTurns = 0
  let totalToolCalls = 0
  let totalToolErrors = 0
  let scoreSum = 0
  let bloat = 0
  let compacted = 0
  let corrections = 0

  for (const entry of list) {
    scoreSum += entry.score ?? 0
    totalTurns += entry.stats?.turns ?? 0
    totalToolCalls += entry.stats?.toolCalls ?? 0
    totalToolErrors += entry.stats?.toolErrors ?? 0
    corrections += entry.corrections ?? 0
    if (Array.isArray(entry.flags)) {
      if (entry.flags.includes('context-bloat')) bloat += 1
      if (entry.flags.includes('compacted')) compacted += 1
    }
    for (const lesson of entry.lessons ?? []) {
      const current = lessons.get(lesson.kind) ?? {
        kind: lesson.kind,
        text: LESSON_LABELS[lesson.kind] ?? lesson.text,
        count: 0,
      }
      current.count += 1
      lessons.set(lesson.kind, current)
    }
    for (const advice of entry.promptAdvice ?? []) {
      const current = promptAdvice.get(advice.kind) ?? {
        kind: advice.kind,
        text: PROMPT_LABELS[advice.kind] ?? advice.text,
        count: 0,
      }
      current.count += 1
      promptAdvice.set(advice.kind, current)
    }
    for (const advice of entry.contextAdvice ?? []) {
      const current = contextAdvice.get(advice.kind) ?? {
        kind: advice.kind,
        text: CONTEXT_LABELS[advice.kind] ?? advice.text,
        count: 0,
      }
      current.count += 1
      contextAdvice.set(advice.kind, current)
    }
    for (const stat of entry.tools ?? []) {
      const current = tools.get(stat.name) ?? { name: stat.name, calls: 0, errors: 0 }
      current.calls += stat.calls ?? 0
      current.errors += stat.errors ?? 0
      tools.set(stat.name, current)
    }
  }

  const byCount = (map) => [...map.values()].sort((a, b) => b.count - a.count)
  return {
    total: list.length,
    avgScore: list.length === 0 ? 0 : Math.round(scoreSum / list.length),
    totalTurns,
    totalToolCalls,
    toolErrorRate: totalToolCalls === 0 ? 0 : Number((totalToolErrors / totalToolCalls).toFixed(3)),
    corrections,
    bloatSessions: bloat,
    compactedSessions: compacted,
    lessons: byCount(lessons).slice(0, 8),
    prompt: byCount(promptAdvice).slice(0, 8),
    context: byCount(contextAdvice).slice(0, 8),
    tools: [...tools.values()].sort((a, b) => b.errors - a.errors || b.calls - a.calls).slice(0, 8),
  }
}

/**
 * Turn a draft prompt plus cross-session advice into a concrete checklist and
 * an augmented prompt. Rules only: the draft is never rewritten away.
 * @param draft - the user's draft prompt.
 * @param advice - `aggregateAdvice()` output, when available.
 * @returns the augmented prompt and the missing dimensions.
 */
export function optimizePrompt(draft, advice) {
  const text = String(draft ?? '').trim()
  const checklist = []
  if (text.length < 60) checklist.push('补充目标与交付物：说明要改什么、最终要得到什么。')
  if (!CONSTRAINT_RE.test(text)) checklist.push('补充约束：技术栈、不能改动的文件、环境限制。')
  if (!ACCEPTANCE_RE.test(text)) checklist.push('补充验收标准：怎样算完成，用什么命令或测试验证。')
  if (!FORMAT_RE.test(text)) checklist.push('补充输出格式：结论先行，再列改动与验证结果。')
  if (!PATH_RE.test(text)) checklist.push('补充定位信息：相关文件、目录或入口点，减少来回查找。')
  if (text.length > 1200) checklist.push('内容偏长：把背景资料放到附件或文件里，正文只留目标与约束。')

  const extra = []
  if (checklist.length > 0) extra.push('补充说明：')
  for (const item of checklist) extra.push(`- ${item}`)
  if (advice && Array.isArray(advice.prompt) && advice.prompt.length > 0) {
    extra.push('')
    extra.push('本机历史会话中的高频问题：')
    for (const item of advice.prompt.slice(0, 3)) extra.push(`- ${item.text}`)
  }
  const prompt = extra.length === 0 ? text : `${text}\n\n${extra.join('\n')}`
  return { prompt, checklist }
}

/**
 * Render the whole library as Markdown.
 * @param entries - digest entries.
 * @param advice - `aggregateAdvice()` output.
 * @returns a Markdown report.
 */
export function exportMarkdown(entries, advice) {
  const list = Object.values(entries ?? {}).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const lines = ['# 对话蒸馏库', '', `共 ${list.length} 个会话 · 平均质量分 ${advice.avgScore} · 更新于 ${new Date().toLocaleString('zh-CN')}`, '']
  if (advice.prompt.length > 0 || advice.context.length > 0) {
    lines.push('## 全局建议', '')
    for (const item of advice.prompt) lines.push(`- 提示词：${item.text}（${item.count} 次）`)
    for (const item of advice.context) lines.push(`- 上下文：${item.text}（${item.count} 次）`)
    lines.push('')
  }
  for (const entry of list) {
    lines.push(`## ${entry.title}`, '')
    lines.push(`- 会话：\`${entry.id}\` · 质量分 ${entry.score} · ${entry.stats.turns} 回合 · ${entry.stats.toolCalls} 次工具调用`)
    if (entry.goal !== '') lines.push(`- 目标：${entry.goal.replace(/\n/gu, ' ')}`)
    if (entry.outcome !== '') lines.push(`- 结果：${entry.outcome.replace(/\n/gu, ' ')}`)
    for (const lesson of entry.lessons) lines.push(`- 经验：${lesson.text}`)
    for (const item of entry.promptAdvice) lines.push(`- 提示词建议：${item.text}`)
    for (const item of entry.contextAdvice) lines.push(`- 上下文建议：${item.text}`)
    lines.push('')
  }
  return lines.join('\n')
}
