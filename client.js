/**
 * Conversation distillery — browser half.
 *
 * Three surfaces:
 * - `sidebar.panellist`: a global icon that selects the library page.
 * - `main` `conversation-distillery`: the library page (list, detail, usage).
 * - `conversation.composer.dock`: one ambient status line; the heavy view
 *   lives in the sidebar page, so the composer stays uncluttered.
 */
window.__ModuleLoader__.load({
  id: '@local/conversation-distillery',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NAMESPACE = 'conversation-distillery'
    const PANEL_ID = 'conversation-distillery'

    const DICTS = {
      zh: {
        'nav.label': '对话蒸馏库',
        'dock.title': '对话蒸馏库',
        'dock.open': '打开',
        'dock.auto': '自动蒸馏',
        'dock.manual': '手动蒸馏',
        'dock.loading': '读取中…',
        'page.title': '对话蒸馏库',
        'page.subtitle': '已收集 {total} 个会话 · 平均 {avg} 分 · 自动蒸馏{state}',
        'page.subtitleOn': '已开启',
        'page.subtitleOff': '未开启',
        'page.usage': '今日已用 {tokens} tokens{limit}',
        'page.usageLimit': ' / 上限 {limit}',
        'page.search': '搜索标题、目标或会话 id',
        'page.rescan': '重新扫描',
        'page.scanning': '扫描中…',
        'page.export': '导出报告',
        'page.sessions': '会话',
        'page.avgScore': '平均质量分',
        'page.tokensToday': '今日 tokens',
        'page.pending': '待蒸馏',
        'page.empty': '还没有收集到会话。',
        'page.select': '从左侧选择一个会话查看蒸馏结果。',
        'page.loading': '正在读取蒸馏库…',
        'page.error': '读取失败：',
        'page.localOnly': '数据保存在本机 DSH 配置目录，不会上传。',
        'page.goal': '目标',
        'page.outcome': '结果',
        'page.lessons': '经验',
        'page.prompt': '提示词建议',
        'page.context': '上下文建议',
        'page.flags': '信号',
        'page.turns': '回合',
        'page.tools': '次工具调用',
        'page.model': '模型蒸馏',
        'page.modelPending': '等待自动蒸馏…',
        'page.modelStale': '会话有更新，等待自动重新蒸馏。',
        'page.modelError': '蒸馏失败：',
        'page.redistill': '重新蒸馏',
        'page.redistilling': '蒸馏中…',
        'page.tokens': 'tokens',
        'page.noDeep': '暂无模型蒸馏结果',
        'page.decisions': '关键决策',
        'page.mistakes': '失误与返工',
        'page.pattern': '可复用模式',
        'page.summary': '摘要',
        'page.budgetEmpty': '今日预算已用完',
        'flag.user-corrections': '用户纠正',
        'flag.aborted-turns': '回合中止',
        'flag.tool-errors': '工具报错',
        'flag.context-bloat': '上下文膨胀',
        'flag.compacted': '发生压缩',
        'flag.no-outcome': '缺少结果',
        'flag.long-session': '超长会话',
      },
      en: {
        'nav.label': 'Conversation distillery',
        'dock.title': 'Conversation distillery',
        'dock.open': 'Open',
        'dock.auto': 'auto distill',
        'dock.manual': 'manual',
        'dock.loading': 'loading…',
        'page.title': 'Conversation distillery',
        'page.subtitle': '{total} conversations · average {avg} · auto distill {state}',
        'page.subtitleOn': 'on',
        'page.subtitleOff': 'off',
        'page.usage': '{tokens} tokens used today{limit}',
        'page.usageLimit': ' / budget {limit}',
        'page.search': 'Search title, goal, or session id',
        'page.rescan': 'Rescan',
        'page.scanning': 'Scanning…',
        'page.export': 'Export report',
        'page.sessions': 'Conversations',
        'page.avgScore': 'Average score',
        'page.tokensToday': 'Tokens today',
        'page.pending': 'Pending',
        'page.empty': 'No conversation collected yet.',
        'page.select': 'Pick a conversation on the left.',
        'page.loading': 'Loading the library…',
        'page.error': 'Could not read the library: ',
        'page.localOnly': 'Stored locally in the DSH profile · never uploaded.',
        'page.goal': 'Goal',
        'page.outcome': 'Outcome',
        'page.lessons': 'Lessons',
        'page.prompt': 'Prompt advice',
        'page.context': 'Context advice',
        'page.flags': 'Signals',
        'page.turns': 'turns',
        'page.tools': 'tool calls',
        'page.model': 'Model distill',
        'page.modelPending': 'Waiting for the automatic distill…',
        'page.modelStale': 'Conversation changed; a fresh distill is queued.',
        'page.modelError': 'Distill failed: ',
        'page.redistill': 'Distill again',
        'page.redistilling': 'Distilling…',
        'page.tokens': 'tokens',
        'page.noDeep': 'No model distill yet',
        'page.decisions': 'Key decisions',
        'page.mistakes': 'Mistakes',
        'page.pattern': 'Reusable pattern',
        'page.summary': 'Summary',
        'page.budgetEmpty': 'Daily token budget exhausted',
        'flag.user-corrections': 'User corrections',
        'flag.aborted-turns': 'Aborted turns',
        'flag.tool-errors': 'Tool errors',
        'flag.context-bloat': 'Context bloat',
        'flag.compacted': 'Compacted',
        'flag.no-outcome': 'No outcome',
        'flag.long-session': 'Long session',
      },
    }

    const colors = {
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      layer: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      base: 'var(--dsw-alias-bg-base)',
      accent: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
    }

    /** Read one JSON route. */
    async function readJson(path) {
      const response = await fetch(path, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}${detail === '' ? '' : ` ${detail.slice(0, 160)}`}`)
      }
      return response.json()
    }

    /** Compact token count: 1234 → 1.2k. */
    function formatTokens(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return '0'
      if (number < 1000) return String(Math.round(number))
      if (number < 1000000) return `${(number / 1000).toFixed(number < 10000 ? 1 : 0)}k`
      return `${(number / 1000000).toFixed(1)}M`
    }

    function dayOf(time) {
      if (typeof time !== 'number' || time <= 0) return ''
      const date = new Date(time)
      return `${date.getMonth() + 1}/${date.getDate()}`
    }

    function timeOf(time) {
      if (typeof time !== 'number' || time <= 0) return ''
      const date = new Date(time)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/gu, (match, key) => (values[key] === undefined ? match : String(values[key])))
    }

    function chip(text, tone) {
      return h(
        'span',
        {
          key: text,
          style: {
            display: 'inline-block',
            fontSize: 10,
            lineHeight: '16px',
            padding: '0 6px',
            borderRadius: 999,
            marginRight: 4,
            marginTop: 4,
            color: tone ?? colors.muted,
            border: `1px solid ${colors.border}`,
            background: colors.layer2,
          },
        },
        text,
      )
    }

    function section(label, text) {
      if (typeof text !== 'string' || text.trim() === '') return null
      return h(
        'div',
        { style: { marginTop: 10 } },
        h('div', { style: { fontSize: 11, color: colors.muted, marginBottom: 3 } }, label),
        h('div', { style: { fontSize: 13, lineHeight: 1.65, color: colors.text, whiteSpace: 'pre-wrap' } }, text),
      )
    }

    function adviceList(label, items) {
      if (!Array.isArray(items) || items.length === 0) return null
      return h(
        'div',
        { style: { marginTop: 10 } },
        h('div', { style: { fontSize: 11, color: colors.muted, marginBottom: 3 } }, label),
        ...items.map((item, index) =>
          h(
            'div',
            {
              key: `${label}-${index}`,
              style: { fontSize: 13, lineHeight: 1.6, color: colors.text, paddingLeft: 12, position: 'relative', marginTop: 2 },
            },
            h('span', { style: { position: 'absolute', left: 0, color: colors.accent } }, '•'),
            typeof item === 'string' ? item : item.text,
          ),
        ),
      )
    }

    function smallButton(label, onClick, disabled) {
      return h(
        'button',
        {
          type: 'button',
          onClick,
          disabled: Boolean(disabled),
          style: {
            padding: '4px 10px',
            borderRadius: 7,
            border: `1px solid ${colors.border}`,
            background: 'transparent',
            color: colors.text,
            fontSize: 12,
            fontFamily: 'inherit',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.6 : 1,
          },
        },
        label,
      )
    }

    /** Left-rail glyph. */
    function NavIcon(props) {
      const size = props && props.size ? props.size : 20
      const active = Boolean(props && props.active)
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block', opacity: active ? 1 : 0.86 },
        },
        h('path', { d: 'M8 3h8v4.2L19 15a3.4 3.4 0 0 1-3.1 4.9H8.1A3.4 3.4 0 0 1 5 15l3-7.8z' }),
        h('path', { d: 'M9.6 13.4h4.8' }),
        h('path', { d: 'M12 16.4v2' }),
      )
    }

    /** One ambient line under the composer; the real view is the sidebar page. */
    function DockRow(props) {
      const t = props.translate
      const openPanel = props.openPanel
      const [summary, setSummary] = React.useState(null)

      React.useEffect(() => {
        let alive = true
        const load = () => {
          readJson('api/conversation-distillery/summary')
            .then((value) => {
              if (alive) setSummary(value)
            })
            .catch(() => {})
        }
        load()
        const timer = setInterval(load, 30000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])

      const total = summary?.stats?.total ?? 0
      const tokens = summary?.usage?.total ?? 0
      const auto = summary?.autoDeep !== false
      const budgetLeft = summary?.usage?.budget ? summary.usage.remaining : -1
      const emptyBudget = budgetLeft === 0
      const parts = [String(total)]
      if (tokens > 0) parts.push(`${formatTokens(tokens)} tokens`)
      if (summary !== null) parts.push(emptyBudget ? t('page.budgetEmpty') : auto ? t('dock.auto') : t('dock.manual'))

      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            minHeight: 22,
            fontSize: 12,
            color: colors.muted,
          },
        },
        h(
          'button',
          {
            type: 'button',
            onClick: openPanel,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '1px 6px',
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              color: colors.muted,
              fontSize: 12,
              fontFamily: 'inherit',
              cursor: 'pointer',
            },
          },
          h('span', { style: { width: 6, height: 6, borderRadius: 3, background: colors.accent, display: 'inline-block' } }),
          t('dock.title'),
          h('span', { style: { color: colors.muted } }, parts.join(' · ')),
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: openPanel,
            style: {
              padding: '0 6px',
              border: 'none',
              background: 'transparent',
              color: colors.accent,
              fontSize: 11,
              fontFamily: 'inherit',
              cursor: 'pointer',
            },
          },
          t('dock.open'),
        ),
      )
    }

    /** The sidebar library page. */
    function LibraryPage(props) {
      const t = props.translate
      const [state, setState] = React.useState({ status: 'loading', error: '', data: null })
      const [selected, setSelected] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const dataRef = React.useRef(null)

      const applyPayload = React.useCallback((data) => {
        dataRef.current = data
        setState({ status: 'ready', error: '', data })
        setSelected((current) => {
          if (current !== null && data.entries.some((entry) => entry.id === current)) return current
          return data.entries.length > 0 ? data.entries[0].id : null
        })
      }, [])

      const load = React.useCallback(async () => {
        try {
          applyPayload(await readJson('api/conversation-distillery/library'))
        } catch (error) {
          setState((current) => ({
            status: current.data === null ? 'error' : 'ready',
            error: error instanceof Error ? error.message : String(error),
            data: current.data,
          }))
        }
      }, [applyPayload])

      React.useEffect(() => {
        void load()
        let alive = true
        const check = () => {
          readJson('api/conversation-distillery/summary')
            .then((summary) => {
              if (!alive) return
              if (dataRef.current === null || dataRef.current.updatedAt !== summary.stats.updatedAt) void load()
            })
            .catch(() => {})
        }
        const timer = setInterval(check, 30000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [load])

      const scan = React.useCallback(async () => {
        setBusy('scan')
        setNotice('')
        try {
          const result = await readJson('api/conversation-distillery/scan?limit=200')
          if (result.library !== undefined) applyPayload(result.library)
          setNotice(`+${result.refreshed}`)
        } catch (error) {
          setNotice(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy('')
        }
      }, [applyPayload])

      const redistill = React.useCallback(
        async (sessionId) => {
          if (typeof sessionId !== 'string' || sessionId === '') return
          setBusy('deep')
          setNotice('')
          try {
            await readJson(`api/conversation-distillery/distill?force=1&sessionId=${encodeURIComponent(sessionId)}`)
            applyPayload(await readJson('api/conversation-distillery/library'))
          } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error))
          } finally {
            setBusy('')
          }
        },
        [applyPayload],
      )

      const data = state.data
      const entries = data?.entries ?? []
      const filtered =
        query.trim() === ''
          ? entries
          : entries.filter((entry) => {
              const needle = query.trim().toLowerCase()
              return (
                String(entry.title ?? '').toLowerCase().includes(needle) ||
                String(entry.goal ?? '').toLowerCase().includes(needle) ||
                String(entry.id).toLowerCase().includes(needle)
              )
            })
      const entry = filtered.find((item) => item.id === selected) ?? entries.find((item) => item.id === selected)
      const usage = data?.usage
      const totalTokens = usage?.total ?? 0
      const limitText = usage && usage.budget ? fill(t('page.usageLimit'), { limit: formatTokens(usage.budget) }) : ''

      const header = h(
        'div',
        { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
        h(
          'div',
          null,
          h('h1', { style: { margin: 0, fontSize: 20, fontWeight: 650, color: colors.text } }, t('page.title')),
          h(
            'p',
            { style: { margin: '5px 0 0', fontSize: 12, lineHeight: 1.5, color: colors.muted } },
            fill(t('page.subtitle'), {
              total: data?.stats?.total ?? 0,
              avg: data?.stats?.avgScore ?? 0,
              state: data?.autoDeep === false ? t('page.subtitleOff') : t('page.subtitleOn'),
            }),
            ' · ',
            fill(t('page.usage'), { tokens: formatTokens(totalTokens), limit: limitText }),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          notice !== '' ? h('span', { style: { fontSize: 11, color: colors.muted } }, notice) : null,
          smallButton(busy === 'scan' ? t('page.scanning') : t('page.rescan'), () => void scan(), busy !== ''),
          h(
            'a',
            {
              href: 'api/conversation-distillery/export',
              target: '_blank',
              rel: 'noreferrer',
              style: {
                padding: '4px 10px',
                borderRadius: 7,
                border: `1px solid ${colors.border}`,
                color: colors.text,
                fontSize: 12,
                textDecoration: 'none',
              },
            },
            t('page.export'),
          ),
        ),
      )

      const statCards = h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 } },
        ...[
          [data?.stats?.total ?? 0, t('page.sessions')],
          [data?.stats?.avgScore ?? 0, t('page.avgScore')],
          [formatTokens(totalTokens), t('page.tokensToday')],
          [data?.stats?.stale ?? 0, t('page.pending')],
        ].map(([value, label]) =>
          h(
            'div',
            {
              key: label,
              style: {
                border: `1px solid ${colors.border}`,
                borderRadius: 11,
                background: colors.layer,
                padding: '10px 12px',
              },
            },
            h('div', { style: { fontSize: 19, fontWeight: 600, lineHeight: 1.1, color: colors.text } }, String(value)),
            h('div', { style: { marginTop: 3, fontSize: 11, color: colors.muted } }, label),
          ),
        ),
      )

      const list = h(
        'div',
        {
          style: {
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            background: colors.layer,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          },
        },
        h(
          'div',
          { style: { padding: 8, borderBottom: `1px solid ${colors.border}` } },
          h('input', {
            type: 'search',
            value: query,
            placeholder: t('page.search'),
            onChange: (event) => setQuery(event.target.value),
            style: {
              width: '100%',
              boxSizing: 'border-box',
              padding: '6px 9px',
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.base,
              color: colors.text,
              fontFamily: 'inherit',
              fontSize: 12,
            },
          }),
        ),
        h(
          'div',
          { style: { overflow: 'auto', padding: 6, minHeight: 0 } },
          state.status === 'loading'
            ? h('div', { style: { padding: 14, fontSize: 12, color: colors.muted } }, t('page.loading'))
            : filtered.length === 0
              ? h(
                  'div',
                  { style: { padding: 14, fontSize: 12, color: colors.muted, lineHeight: 1.6 } },
                  state.error !== '' ? `${t('page.error')}${state.error}` : t('page.empty'),
                )
              : filtered.map((item) =>
                  h(
                    'button',
                    {
                      key: item.id,
                      type: 'button',
                      onClick: () => setSelected(item.id),
                      style: {
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '7px 8px',
                        border: 'none',
                        borderRadius: 8,
                        background: item.id === selected ? colors.layer2 : 'transparent',
                        color: colors.text,
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                      },
                    },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
                      h(
                        'span',
                        {
                          style: {
                            flex: '1 1 auto',
                            minWidth: 0,
                            fontSize: 12.5,
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          },
                        },
                        item.title,
                      ),
                      h('span', { style: { flex: 'none', fontSize: 11, color: colors.muted } }, String(item.score)),
                    ),
                    h(
                      'div',
                      { style: { fontSize: 10.5, color: colors.muted, marginTop: 2 } },
                      `${item.stats?.turns ?? 0} ${t('page.turns')} · ${item.stats?.toolCalls ?? 0} ${t('page.tools')} · ${dayOf(item.updatedAt)}`,
                    ),
                  ),
                ),
        ),
      )

      const detail = h(
        'div',
        {
          style: {
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            background: colors.layer,
            overflow: 'auto',
            minHeight: 0,
            padding: '14px 16px',
          },
        },
        entry === undefined
          ? h('div', { style: { fontSize: 12, color: colors.muted } }, t('page.select'))
          : h(
              'div',
              null,
              h(
                'div',
                { style: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' } },
                h(
                  'div',
                  { style: { minWidth: 0 } },
                  h('div', { style: { fontSize: 15, fontWeight: 600, color: colors.text, lineHeight: 1.4 } }, entry.title),
                  h(
                    'div',
                    { style: { marginTop: 3, fontSize: 11, color: colors.muted } },
                    `${entry.score} 分 · ${entry.stats?.turns ?? 0} ${t('page.turns')} · ${entry.stats?.toolCalls ?? 0} ${t('page.tools')}${entry.deepAt ? ` · ${t('page.model')} ${timeOf(entry.deepAt)}` : ''}`,
                  ),
                ),
                smallButton(
                  busy === 'deep' ? t('page.redistilling') : t('page.redistill'),
                  () => void redistill(entry.id),
                  busy !== '',
                ),
              ),
              h(
                'div',
                { style: { marginTop: 4 } },
                ...(entry.flags ?? []).map((flag) =>
                  chip(t(`flag.${flag}`), flag === 'user-corrections' || flag === 'tool-errors' ? colors.warn : colors.muted),
                ),
              ),
              section(t('page.goal'), entry.goal),
              section(t('page.outcome'), entry.outcome),
              adviceList(t('page.lessons'), entry.lessons),
              adviceList(t('page.prompt'), entry.promptAdvice),
              adviceList(t('page.context'), entry.contextAdvice),
              h(
                'div',
                { style: { marginTop: 16, paddingTop: 12, borderTop: `1px dashed ${colors.border2}` } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
                  h('div', { style: { fontSize: 12, fontWeight: 600, color: colors.accent } }, t('page.model')),
                  entry.deepModel ? h('span', { style: { fontSize: 10.5, color: colors.muted } }, entry.deepModel) : null,
                  entry.deepUsage
                    ? h(
                        'span',
                        { style: { fontSize: 10.5, color: colors.muted } },
                        `${formatTokens((entry.deepUsage.input ?? 0) + (entry.deepUsage.output ?? 0))} ${t('page.tokens')}`,
                      )
                    : null,
                ),
                entry.deep === undefined
                  ? h(
                      'div',
                      { style: { marginTop: 8, fontSize: 12, color: colors.muted } },
                      entry.deepError ? `${t('page.modelError')}${entry.deepError}` : t('page.modelPending'),
                    )
                  : h(
                      'div',
                      null,
                      entry.deepStale === true
                        ? h('div', { style: { marginTop: 6, fontSize: 11, color: colors.warn } }, t('page.modelStale'))
                        : null,
                      section(t('page.goal'), entry.deep.goal),
                      section(t('page.outcome'), entry.deep.outcome),
                      adviceList(t('page.decisions'), entry.deep.decisions),
                      adviceList(t('page.mistakes'), entry.deep.mistakes),
                      adviceList(t('page.prompt'), entry.deep.promptImprovements),
                      adviceList(t('page.context'), entry.deep.contextImprovements),
                      section(t('page.pattern'), entry.deep.reusablePattern),
                      section(t('page.summary'), entry.deep.summary),
                    ),
              ),
            ),
      )

      return h(
        'div',
        {
          style: {
            height: '100%',
            overflow: 'auto',
            boxSizing: 'border-box',
            padding: '22px 26px 26px',
            color: colors.text,
          },
        },
        h(
          'div',
          { style: { maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 } },
          header,
          state.error !== '' && state.data !== null
            ? h('div', { style: { fontSize: 12, color: colors.error } }, `${t('page.error')}${state.error}`)
            : null,
          statCards,
          h(
            'div',
            {
              style: {
                display: 'grid',
                gridTemplateColumns: 'minmax(220px, 340px) minmax(0, 1fr)',
                gap: 12,
                height: 'calc(100vh - 280px)',
                minHeight: 340,
              },
            },
            list,
            detail,
          ),
          h('div', { style: { fontSize: 10.5, color: colors.muted } }, t('page.localOnly')),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        let t = (key) => key
        try {
          ctx.effect(() => ctx.locale.register(NAMESPACE, DICTS), 'conversation-distillery: dictionaries')
          t = ctx.locale.bind(NAMESPACE)
        } catch {
          // A locale failure must not blank the UI; fall back to raw keys.
        }

        const openPanel = () => {
          try {
            ctx.get('layout')?.selectPanel(PANEL_ID)
          } catch {
            // The sidebar selection is unavailable in this shell.
          }
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 25,
              label: () => {
                try {
                  return t('nav.label')
                } catch {
                  return 'Conversation distillery'
                }
              },
            },
            NavIcon,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, (panelProps) =>
            h(LibraryPage, { ...panelProps, translate: t, ctx }),
          ),
        )

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: PANEL_ID, order: 40 },
            (dockProps) => h(DockRow, { ...dockProps, translate: t, openPanel, ctx }),
          ),
        )
      },
    }
  },
})
