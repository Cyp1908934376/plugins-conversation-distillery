/**
 * Conversation distillery — Host half.
 *
 * Collects every conversation the corpus can see, folds each log into a
 * deterministic digest (goal, outcome, tool path, failure signals, reusable
 * lessons), caches it in the DSH profile, and exposes the result three ways:
 * an agent tool, authenticated `/api/conversation-distillery/*` routes for the
 * dock panel, and Markdown export. A model-based "deep distill" is on demand and
 * never automatic.
 */
import {
  DIGEST_VERSION,
  aggregateAdvice,
  analyzeSession,
  buildTranscript,
  clip,
  exportMarkdown,
  optimizePrompt,
} from './lib/digest.js'
import { LibraryStore, resolveStoreDir } from './lib/store.js'

/** Services this plugin cannot work without. */
export const inject = ['tools', 'sessionQuery', 'connection']

const DEFAULTS = {
  autoCollect: true,
  initialScanLimit: 200,
  debounceMs: 4000,
  startupDelayMs: 6000,
  storeDir: '',
  deepProvider: '',
  deepModel: '',
  maxEntries: 400,
}

const DEEP_PROMPT = `你是一个对话蒸馏器。阅读下面一段真实的人机协作对话，提炼可复用的经验，帮助下一次对话更准确、更省上下文。

只输出一个 JSON 对象，不要输出别的文字。字段：
{
  "goal": "用户真正想完成的目标，一句话",
  "outcome": "最终完成到什么程度，一句话",
  "decisions": ["关键决策，最多3条"],
  "mistakes": ["过程中的错误或返工，最多3条"],
  "promptImprovements": ["下次写提示词时应补充什么，最多3条"],
  "contextImprovements": ["怎样减少上下文浪费，最多3条"],
  "reusablePattern": "可复用的做法或模板，一到两句",
  "confidence": 0-1 的数字
}

对话：
"""
{{transcript}}
"""`

/**
 * Register the collector, the tool, and the read routes.
 * @param ctx - Host context carrying tools, session-query, and connection.
 * @param config - row configuration.
 */
export function apply(ctx, config = {}) {
  const options = { ...DEFAULTS, ...config }
  const store = new LibraryStore(resolveStoreDir(options.storeDir))
  const ready = store.load()
  const pending = new Map()
  let scanPromise = undefined
  let lastError = ''

  /** @returns the query service, or throws. */
  function query() {
    const service = ctx.get('sessionQuery')
    if (service === undefined) throw new Error('会话查询服务不可用')
    return service
  }

  /** @returns a stable cache fingerprint for one event list. */
  function fingerprintOf(events) {
    const list = Array.isArray(events) ? events : []
    const last = list[list.length - 1]
    return `${list.length}:${last?.seq ?? 0}:${last?.time ?? 0}`
  }

  /**
   * Recompute one session's digest from its stored log.
   * @param sessionId - target session id.
   * @param root0 - persistence option.
   * @param root0.persist - write the cache immediately (false inside a batch).
   * @returns the refreshed entry.
   */
  async function refreshSession(sessionId, { persist = true } = {}) {
    await ready
    const service = query()
    const snapshot = await service.readSession(sessionId)
    let title
    try {
      const observation = await service.readTitleSnapshot(sessionId)
      title = observation?.title?.title
    } catch {
      title = undefined
    }
    const entry = analyzeSession(snapshot, title)
    const previous = store.get(entry.id)
    if (previous?.deep !== undefined) {
      entry.deep = previous.deep
      entry.deepAt = previous.deepAt
      entry.deepModel = previous.deepModel
      entry.deepStale = previous.fingerprint !== entry.fingerprint || previous.digestVersion !== DIGEST_VERSION
    }
    entry.fingerprint = fingerprintOf(snapshot.events)
    store.upsert(entry)
    if (persist) await store.save()
    return entry
  }

  /**
   * Scan the corpus, refreshing only sessions whose log changed.
   * @param root0 - scan options.
   * @param root0.limit - maximum sessions to inspect, newest first.
   * @param root0.force - ignore fingerprints and rewrite every digest.
   * @returns counters for the scan.
   */
  async function scanAll({ limit = 200, force = false } = {}) {
    await ready
    const service = query()
    const records = await service.listSessions()
    const sorted = [...records].sort((a, b) => (b.header?.createdAt ?? 0) - (a.header?.createdAt ?? 0))
    const selected = sorted.slice(0, Math.max(1, Math.min(2000, limit)))
    let refreshed = 0
    let skipped = 0
    let failed = 0
    for (const record of selected) {
      const id = String(record.header?.id ?? '')
      if (id === '') continue
      try {
        if (!force) {
          const previous = store.get(id)
          if (previous !== undefined && previous.digestVersion === DIGEST_VERSION) {
            const events = await service.listEvents(id)
            if (fingerprintOf(events) === previous.fingerprint) {
              skipped += 1
              continue
            }
          }
        }
        await refreshSession(id, { persist: false })
        refreshed += 1
      } catch {
        failed += 1
      }
    }
    if (sorted.length > 0) {
      const liveIds = sorted.map((record) => String(record.header?.id ?? ''))
      store.prune(liveIds.filter((id) => id !== ''))
    }
    await store.save()
    return { total: sorted.length, inspected: selected.length, refreshed, skipped, failed }
  }

  /** Start one scan, sharing the in-flight promise. */
  function scanOnce(optionsForScan) {
    if (scanPromise !== undefined) return scanPromise
    scanPromise = scanAll(optionsForScan)
      .catch((error) => {
        lastError = error instanceof Error ? error.message : String(error)
        return { total: 0, inspected: 0, refreshed: 0, skipped: 0, failed: 0, error: lastError }
      })
      .finally(() => {
        scanPromise = undefined
      })
    return scanPromise
  }

  /** Debounce one session refresh after a turn boundary. */
  function schedule(sessionId) {
    if (pending.has(sessionId)) return
    const timer = setTimeout(() => {
      pending.delete(sessionId)
      void refreshSession(sessionId).catch((error) => {
        lastError = error instanceof Error ? error.message : String(error)
      })
    }, Math.max(250, Number(options.debounceMs) || 4000))
    if (typeof timer.unref === 'function') timer.unref()
    pending.set(sessionId, timer)
  }

  /** @returns the model route for deep work, when resolvable. */
  function resolveModel(sessionId) {
    if (options.deepProvider !== '' && options.deepModel !== '') {
      return { provider: options.deepProvider, model: options.deepModel }
    }
    try {
      const live = ctx.get('sessions')?.get(sessionId)
      const header = live?.requestHeader?.()
      if (header?.config?.provider && header.config.model) {
        return { provider: header.config.provider, model: header.config.model }
      }
    } catch {
      // Fall through to the profile default.
    }
    try {
      const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
      if (selection?.provider && selection?.model) return { provider: selection.provider, model: selection.model }
    } catch {
      // No default model in this profile.
    }
    return undefined
  }

  /**
   * Stream one model call and collect its text.
   * @param route - provider/model pair.
   * @param prompt - user prompt.
   * @param maxTokens - output budget.
   * @returns the collected text.
   */
  async function callModel(route, prompt, maxTokens) {
    const llm = ctx.get('llm')
    if (llm === undefined) throw new Error('模型服务不可用，无法做深度蒸馏')
    const prepared = await llm.prepareCall({ ...route, maxTokens: maxTokens ?? 1600 }, undefined, (controls, model) => {
      const efforts = model?.reasoning?.efforts
      return Array.isArray(efforts) && efforts.length > 0 ? { ...controls, reasoningEffort: efforts[0].id } : controls
    })
    const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
    let text = ''
    let blockText = ''
    let finishKind = 'unknown'
    let sawReasoning = false
    for await (const chunk of prepared.stream({ ...prepared.config, messages })) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk?.type === 'reasoning-delta') sawReasoning = true
      else if (chunk?.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
        blockText += chunk.block.text
      } else if (chunk?.type === 'finish') {
        finishKind = chunk.reason?.kind ?? 'unknown'
        if (finishKind === 'error') throw new Error(chunk.reason?.failure?.message ?? '模型调用失败')
        if (finishKind === 'aborted') throw new Error('模型调用被中止')
      }
    }
    const output = text.trim() !== '' ? text : blockText
    if (output.trim() === '') {
      throw new Error(
        `模型没有返回文本（finish=${finishKind}${sawReasoning ? '，只返回了推理内容' : ''}）。可在插件配置里换一个非推理模型。`,
      )
    }
    return output
  }

  /** Extract the first JSON object from free-form model text. */
  function parseJsonLoose(text) {
    const stripped = String(text).replace(/^```(?:json)?\s*/iu, '').replace(/```\s*$/u, '').trim()
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start < 0 || end <= start) return undefined
    try {
      const value = JSON.parse(stripped.slice(start, end + 1))
      return value && typeof value === 'object' ? value : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Model-distill one session and cache the result on its entry.
   * @param sessionId - target session.
   * @param force - recompute even when a fresh deep result exists.
   * @returns the stored entry.
   */
  async function deepDistill(sessionId, force = false) {
    await ready
    const entry = store.get(sessionId) ?? (await refreshSession(sessionId))
    if (!force && entry.deep !== undefined && entry.deepStale !== true) return entry
    const route = resolveModel(sessionId)
    if (route === undefined) {
      throw new Error('无法确定模型：请在 plugin config 里设置 deepProvider 与 deepModel')
    }
    const snapshot = await query().readSession(sessionId)
    const transcript = buildTranscript(snapshot, 16000)
    if (transcript.trim() === '') throw new Error('该会话没有可蒸馏的文本内容')
    const text = await callModel(route, DEEP_PROMPT.replace('{{transcript}}', transcript), 2400)
    const parsed = parseJsonLoose(text)
    entry.deep = parsed ?? { summary: clip(text, 2000), raw: true }
    entry.deepAt = Date.now()
    entry.deepModel = `${route.provider}/${route.model}`
    entry.deepStale = false
    store.upsert(entry)
    await store.save()
    return entry
  }

  /** Build the compact payload the dock panel reads. */
  async function libraryPayload() {
    await ready
    const entries = store.list().slice(0, Number(options.maxEntries) || 400)
    const advice = aggregateAdvice(store.entries())
    return {
      updatedAt: store.data.updatedAt,
      stats: {
        total: Object.keys(store.entries()).length,
        listed: entries.length,
        stale: entries.filter((entry) => entry.digestVersion !== DIGEST_VERSION || entry.deepStale === true).length,
        avgScore: advice.avgScore,
        totalTurns: advice.totalTurns,
        toolErrorRate: advice.toolErrorRate,
        lastError,
      },
      advice,
      entries: entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        cwd: entry.cwd,
        score: entry.score,
        flags: entry.flags,
        stats: entry.stats,
        tools: entry.tools,
        goal: entry.goal,
        outcome: entry.outcome,
        lessons: entry.lessons,
        promptAdvice: entry.promptAdvice,
        contextAdvice: entry.contextAdvice,
        deep: entry.deep,
        deepStale: entry.deepStale === true,
      })),
    }
  }

  /** Render one entry as compact Markdown for the agent. */
  function formatEntry(entry) {
    const lines = [`## ${entry.title}`, `会话：${entry.id} · 质量分 ${entry.score} · ${entry.stats.turns} 回合 · ${entry.stats.toolCalls} 次工具调用`]
    if (entry.goal !== '') lines.push(`目标：${entry.goal.replace(/\n/gu, ' ')}`)
    if (entry.outcome !== '') lines.push(`结果：${entry.outcome.replace(/\n/gu, ' ')}`)
    if (entry.keySteps.length > 0) lines.push(`路径：${entry.keySteps.join(' → ')}`)
    if (entry.files.length > 0) lines.push(`涉及文件：${entry.files.join(', ')}`)
    for (const lesson of entry.lessons) lines.push(`经验：${lesson.text}`)
    for (const advice of entry.promptAdvice) lines.push(`提示词建议：${advice.text}`)
    for (const advice of entry.contextAdvice) lines.push(`上下文建议：${advice.text}`)
    if (entry.deep !== undefined) {
      const deep = entry.deep
      lines.push('', '### 模型蒸馏')
      if (deep.goal) lines.push(`目标：${deep.goal}`)
      if (deep.outcome) lines.push(`结果：${deep.outcome}`)
      for (const item of deep.decisions ?? []) lines.push(`决策：${item}`)
      for (const item of deep.mistakes ?? []) lines.push(`失误：${item}`)
      for (const item of deep.promptImprovements ?? []) lines.push(`提示词改进：${item}`)
      for (const item of deep.contextImprovements ?? []) lines.push(`上下文改进：${item}`)
      if (deep.reusablePattern) lines.push(`可复用模式：${deep.reusablePattern}`)
      if (deep.summary) lines.push(deep.summary)
      if (entry.deepStale === true) lines.push('（模型蒸馏早于最新对话，建议重新蒸馏）')
    }
    return lines.join('\n')
  }

  /** Render the aggregated advice as Markdown. */
  function formatAdvice(advice) {
    const lines = [
      `共 ${advice.total} 个会话 · 平均质量分 ${advice.avgScore} · 工具失败率 ${(advice.toolErrorRate * 100).toFixed(1)}%`,
      `总回合 ${advice.totalTurns} · 用户纠正 ${advice.corrections} 次 · 上下文膨胀会话 ${advice.bloatSessions} 个 · 发生压缩 ${advice.compactedSessions} 个`,
    ]
    if (advice.prompt.length > 0) {
      lines.push('', '提示词层面：')
      for (const item of advice.prompt) lines.push(`- ${item.text}（${item.count} 个会话）`)
    }
    if (advice.context.length > 0) {
      lines.push('', '上下文层面：')
      for (const item of advice.context) lines.push(`- ${item.text}（${item.count} 个会话）`)
    }
    if (advice.lessons.length > 0) {
      lines.push('', '可复用经验：')
      for (const item of advice.lessons) lines.push(`- ${item.text}（${item.count} 个会话）`)
    }
    if (advice.tools.length > 0) {
      lines.push('', '工具健康度：')
      for (const item of advice.tools) lines.push(`- ${item.name}：${item.calls} 次调用，${item.errors} 次失败`)
    }
    return lines.join('\n')
  }

  /** JSON response helper. */
  function json(value, status = 200) {
    return new Response(JSON.stringify(value, undefined, 2), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  /** Wrap one route body with error handling. */
  function route(handler) {
    return async (request) => {
      try {
        return await handler(request)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        lastError = message
        return json({ error: message }, 500)
      }
    }
  }

  // ---- Tool -------------------------------------------------------------

  const tool = {
    name: 'conversation_library',
    description:
      '本机的对话蒸馏库：把每一次历史会话蒸馏成目标、结果、工具路径、失败信号和可复用经验，用来优化提示词、精简上下文。' +
      'action=list 列出会话摘要；digest 蒸馏单个会话（deep=true 时调用模型深度蒸馏）；refresh 重新扫描；' +
      'advice 汇总跨会话经验；optimize_prompt 依据历史经验补全草稿提示词；export 写出 Markdown 报告。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'digest', 'refresh', 'advice', 'optimize_prompt', 'export'],
          description: '要执行的操作。',
        },
        sessionId: { type: 'string', description: 'digest 的目标会话 id；省略时使用当前会话。' },
        prompt: { type: 'string', description: 'optimize_prompt 的草稿提示词。' },
        deep: { type: 'boolean', description: '是否调用模型做深度蒸馏或改写，默认 false。' },
        limit: { type: 'integer', description: 'list/refresh 的最大会话数，默认 50。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: { text: { type: 'string' } },
      },
      render(_args, value) {
        return [{ type: 'text', text: typeof value?.text === 'string' ? value.text : '' }]
      },
    },
    async execute(args, exec) {
      const action = String(args?.action ?? 'list')
      const currentSession = exec?.agent?.id
      if (action === 'list') {
        await ready
        const limit = Math.max(1, Math.min(200, Number(args?.limit) || 50))
        const entries = store.list().slice(0, limit)
        if (entries.length === 0) {
          const scanned = await scanOnce({ limit: Number(options.initialScanLimit) || 40 })
          return {
            text: `蒸馏库为空。已扫描 ${scanned.inspected} 个会话，生成 ${scanned.refreshed} 条摘要。再次调用 list 查看。`,
          }
        }
        const advice = aggregateAdvice(store.entries())
        const lines = [`共 ${advice.total} 个会话，平均质量分 ${advice.avgScore}。`, '']
        for (const entry of entries) {
          const flags = entry.flags.length === 0 ? '' : ` · ${entry.flags.join(',')}`
          lines.push(`- ${entry.title}（${entry.score} 分 · ${entry.stats.turns} 回合${flags}）id=${entry.id}`)
          if (entry.goal !== '') lines.push(`  目标：${clip(entry.goal, 120)}`)
        }
        lines.push('', '用 action=digest 查看单个会话的完整蒸馏。')
        return { text: lines.join('\n') }
      }

      if (action === 'digest') {
        const sessionId = typeof args?.sessionId === 'string' && args.sessionId !== '' ? args.sessionId : currentSession
        if (sessionId === undefined) throw new Error('digest 需要一个 sessionId')
        const entry = args?.deep === true ? await deepDistill(String(sessionId)) : await refreshSession(String(sessionId))
        return { text: formatEntry(entry) }
      }

      if (action === 'refresh') {
        const result = await scanOnce({ limit: Number(args?.limit) || 60, force: args?.deep === true })
        return {
          text: `扫描完成：共 ${result.total} 个会话，检查 ${result.inspected} 个，更新 ${result.refreshed} 个，跳过 ${result.skipped} 个，失败 ${result.failed} 个。`,
        }
      }

      if (action === 'advice') {
        await ready
        const advice = aggregateAdvice(store.entries())
        return { text: formatAdvice(advice) }
      }

      if (action === 'optimize_prompt') {
        const draft = typeof args?.prompt === 'string' ? args.prompt.trim() : ''
        if (draft === '') throw new Error('optimize_prompt 需要 prompt')
        await ready
        const advice = aggregateAdvice(store.entries())
        const result = optimizePrompt(draft, advice)
        if (args?.deep === true) {
          const route = resolveModel(currentSession)
          if (route === undefined) {
            return { text: `无法调用模型（未确定模型路由），下面是规则结果：\n\n${result.prompt}` }
          }
          const prompt = [
            '你是提示词工程师。基于下面这个本机历史会话蒸馏库的高频问题，改写用户的草稿提示词：保留原意，补全目标、约束、验收标准、输出格式，去掉冗余背景，控制在 400 字以内。只输出改写后的提示词。',
            '',
            '高频问题：',
            ...advice.prompt.map((item) => `- ${item.text}`),
            '',
            `草稿：${draft}`,
          ].join('\n')
          const rewritten = await callModel(route, prompt, 1200)
          return { text: `已改写：\n\n${rewritten.trim()}` }
        }
        return { text: result.prompt }
      }

      if (action === 'export') {
        await ready
        const advice = aggregateAdvice(store.entries())
        const markdown = exportMarkdown(store.entries(), advice)
        const file = await store.writeReport(markdown)
        return { text: `已写出 ${file}\n\n${clip(markdown, 1500)}` }
      }

      throw new Error(`未知 action: ${action}`)
    },
  }

  ctx.effect(() => ctx.tools.register(tool), 'conversation-distillery: tool')

  // ---- Routes -----------------------------------------------------------

  const routes = [
    {
      path: '/api/conversation-distillery/library',
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: route(async () => json(await libraryPayload())),
    },
    {
      path: '/api/conversation-distillery/digest',
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: route(async (request) => {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        if (sessionId === null || sessionId === '') return json({ error: 'missing sessionId' }, 400)
        const entry = store.get(sessionId) ?? (await refreshSession(sessionId))
        return json(entry)
      }),
    },
    {
      path: '/api/conversation-distillery/refresh',
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: route(async (request) => {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        if (sessionId === null || sessionId === '') return json({ error: 'missing sessionId' }, 400)
        return json(await refreshSession(sessionId))
      }),
    },
    {
      path: '/api/conversation-distillery/scan',
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: route(async (request) => {
        const limit = Number(new URL(request.url).searchParams.get('limit')) || Number(options.initialScanLimit) || 40
        const result = await scanOnce({ limit })
        return json({ ...result, library: await libraryPayload() })
      }),
    },
    {
      path: '/api/conversation-distillery/distill',
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: route(async (request) => {
        const params = new URL(request.url).searchParams
        const sessionId = params.get('sessionId')
        if (sessionId === null || sessionId === '') return json({ error: 'missing sessionId' }, 400)
        const force = params.get('force') === '1'
        return json(await deepDistill(sessionId, force))
      }),
    },
    {
      path: '/api/conversation-distillery/advice',
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: route(async () => {
        await ready
        const advice = aggregateAdvice(store.entries())
        return json({ advice, markdown: formatAdvice(advice) })
      }),
    },
    {
      path: '/api/conversation-distillery/export',
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: route(async () => {
        await ready
        const advice = aggregateAdvice(store.entries())
        const markdown = exportMarkdown(store.entries(), advice)
        const file = await store.writeReport(markdown)
        return new Response(markdown, {
          headers: { 'content-type': 'text/markdown; charset=utf-8', 'x-report-path': file },
        })
      }),
    },
  ]

  if (typeof ctx.connection?.fetch?.register === 'function') {
    for (const definition of routes) {
      ctx.effect(() => ctx.connection.fetch.register(definition), `conversation-distillery: ${definition.path}`)
    }
  }

  // ---- Collection -------------------------------------------------------

  ctx.effect(
    () => {
      const off = ctx.on('session/event', (session, event) => {
        if (options.autoCollect === false) return
        if (event?.type !== 'turn/end') return
        const id = String(session?.id ?? '')
        if (id !== '') schedule(id)
      })
      return typeof off === 'function' ? off : () => {}
    },
    'conversation-distillery: turn boundaries',
  )

  ctx.effect(
    () => () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    },
    'conversation-distillery: pending timers',
  )

  if (options.autoCollect !== false) {
    const timer = setTimeout(() => {
      void scanOnce({ limit: Number(options.initialScanLimit) || 40 })
    }, Math.max(500, Number(options.startupDelayMs) || 6000))
    if (typeof timer.unref === 'function') timer.unref()
    ctx.effect(() => () => clearTimeout(timer), 'conversation-distillery: startup scan')
  }
}
