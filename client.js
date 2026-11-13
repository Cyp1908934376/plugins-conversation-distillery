/**
 * Conversation distillery — browser half.
 *
 * Renders one ambient row under the composer. Opening it reads the cached
 * library from the Host's authenticated `/api/conversation-distillery` routes
 * and shows each conversation's digest, plus buttons that distill the current
 * conversation (rules) or ask the model for a deep digest.
 */
window.__ModuleLoader__.load({
  id: '@local/conversation-distillery',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NAMESPACE = 'conversation-distillery'

    const DICTS = {
      zh: {
        'dock.title': '对话蒸馏库',
        'dock.loading': '正在读取蒸馏库…',
        'dock.empty': '还没有收集到会话，完成第一轮对话后会自动生成摘要。',
        'dock.refresh': '重新扫描',
        'dock.scanning': '扫描中…',
        'dock.distill': '蒸馏当前对话',
        'dock.distilling': '蒸馏中…',
        'dock.deep': '深度蒸馏',
        'dock.export': '导出报告',
        'dock.score': '质量分',
        'dock.goal': '目标',
        'dock.outcome': '结果',
        'dock.lessons': '经验',
        'dock.promptAdvice': '提示词建议',
        'dock.contextAdvice': '上下文建议',
        'dock.stale': '待蒸馏',
        'dock.error': '蒸馏库读取失败：',
        'dock.localOnly': '数据保存在本机 DSH 配置目录，不会上传。',
        'dock.noDetail': '选择左侧会话查看蒸馏结果。',
        'flag.user-corrections': '用户纠正',
        'flag.aborted-turns': '回合中止',
        'flag.tool-errors': '工具报错',
        'flag.context-bloat': '上下文膨胀',
        'flag.compacted': '发生压缩',
        'flag.no-outcome': '缺少结果',
        'flag.long-session': '超长会话',
      },
      en: {
        'dock.title': 'Conversation distillery',
        'dock.loading': 'Loading the library…',
        'dock.empty': 'No conversation collected yet. A digest appears after the first completed turn.',
        'dock.refresh': 'Rescan',
        'dock.scanning': 'Scanning…',
        'dock.distill': 'Distill this conversation',
        'dock.distilling': 'Distilling…',
        'dock.deep': 'Deep distill',
        'dock.export': 'Export report',
        'dock.score': 'Quality',
        'dock.goal': 'Goal',
        'dock.outcome': 'Outcome',
        'dock.lessons': 'Lessons',
        'dock.promptAdvice': 'Prompt advice',
        'dock.contextAdvice': 'Context advice',
        'dock.stale': 'to distill',
        'dock.error': 'The library could not be read: ',
        'dock.localOnly': 'Stored locally in the DSH profile · never uploaded.',
        'dock.noDetail': 'Pick a conversation on the left.',
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
      layer: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
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

    /** One short local date. */
    function dayOf(time) {
      if (typeof time !== 'number' || time <= 0) return ''
      const date = new Date(time)
      return `${date.getMonth() + 1}/${date.getDate()}`
    }

    /** A tiny labelled block. */
    function section(label, text) {
      if (typeof text !== 'string' || text.trim() === '') return null
      return h(
        'div',
        { style: { marginTop: 8 } },
        h('div', { style: { fontSize: 11, color: colors.muted, marginBottom: 2 } }, label),
        h('div', { style: { fontSize: 12, lineHeight: 1.55, color: colors.text, whiteSpace: 'pre-wrap' } }, text),
      )
    }

    /** A list of advice items. */
    function adviceList(label, items, t) {
      if (!Array.isArray(items) || items.length === 0) return null
      return h(
        'div',
        { style: { marginTop: 8 } },
        h('div', { style: { fontSize: 11, color: colors.muted, marginBottom: 2 } }, label),
        ...items.map((item, index) =>
          h(
            'div',
            { key: `${label}-${index}`, style: { fontSize: 12, lineHeight: 1.5, color: colors.text, paddingLeft: 10, position: 'relative' } },
            h('span', { style: { position: 'absolute', left: 0, color: colors.accent } }, '•'),
            typeof item === 'string' ? item : item.text,
          ),
        ),
      )
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

    /** The one dock entry. */
    function DistilleryDock(props) {
      const t = props.translate
      const sessionId = props.sessionId
      const [open, setOpen] = React.useState(false)
      const [state, setState] = React.useState({ status: 'idle', error: null, data: null })
      const [selected, setSelected] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')

      const load = React.useCallback(async () => {
        setState((current) => ({ ...current, status: 'loading', error: null }))
        try {
          const data = await readJson('api/conversation-distillery/library')
          setState({ status: 'ready', error: null, data })
        } catch (error) {
          setState({ status: 'error', error: error instanceof Error ? error.message : String(error), data: null })
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [])

      React.useEffect(() => {
        if (open && state.status === 'error') void load()
      }, [open, state.status])

      const scan = React.useCallback(async () => {
        setBusy('scan')
        setNotice('')
        try {
          const result = await readJson('api/conversation-distillery/scan?limit=60')
          setState({ status: 'ready', error: null, data: result.library })
          setNotice(`+${result.refreshed} / ${result.total}`)
        } catch (error) {
          setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }))
        } finally {
          setBusy('')
        }
      }, [])

      const distillCurrent = React.useCallback(
        async (deep) => {
          if (typeof sessionId !== 'string' || sessionId === '') return
          setBusy(deep ? 'deep' : 'distill')
          setNotice('')
          try {
            if (deep) {
              await readJson(`api/conversation-distillery/distill?force=1&sessionId=${encodeURIComponent(sessionId)}`)
            } else {
              await readJson(`api/conversation-distillery/refresh?sessionId=${encodeURIComponent(sessionId)}`)
            }
            const data = await readJson('api/conversation-distillery/library')
            setState({ status: 'ready', error: null, data })
            setSelected(sessionId)
            setNotice(deep ? '✓' : '✓')
          } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error))
          } finally {
            setBusy('')
          }
        },
        [sessionId],
      )

      const data = state.data
      const entries = data?.entries ?? []
      const total = data?.stats?.total ?? 0
      const stale = data?.stats?.stale ?? 0
      const entry = entries.find((item) => item.id === selected)

      const summaryParts = data === null ? ['…'] : [String(total)]
      if (data !== null && stale > 0) summaryParts.push(`${stale} ${t('dock.stale')}`)

      const row = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 22, fontSize: 12, color: colors.muted } },
        h(
          'button',
          {
            type: 'button',
            onClick: () => setOpen((value) => !value),
            'aria-expanded': open,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '1px 6px',
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              color: open ? colors.text : colors.muted,
              font: 'inherit',
              cursor: 'pointer',
            },
          },
          h('span', { style: { width: 6, height: 6, borderRadius: 3, background: colors.accent, display: 'inline-block' } }),
          t('dock.title'),
          h('span', { style: { color: colors.muted } }, summaryParts.join(' · ')),
          h('span', { style: { fontSize: 10 } }, open ? '▾' : '▸'),
        ),
        state.status === 'error'
          ? h('span', { style: { color: colors.error, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${t('dock.error')}${state.error}`)
          : null,
        notice !== '' ? h('span', { style: { color: colors.muted } }, notice) : null,
      )

      if (!open) return h('div', { style: { width: '100%' } }, row)

      const list = h(
        'div',
        { style: { overflow: 'auto', maxHeight: 216, borderRight: `1px solid ${colors.border}`, padding: 4 } },
        entries.length === 0
          ? h('div', { style: { padding: 10, fontSize: 12, color: colors.muted, lineHeight: 1.5 } }, state.status === 'loading' ? t('dock.loading') : t('dock.empty'))
          : entries.map((item) =>
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
                    padding: '5px 7px',
                    border: 'none',
                    borderRadius: 7,
                    background: item.id === selected ? colors.layer2 : 'transparent',
                    color: colors.text,
                    cursor: 'pointer',
                    font: 'inherit',
                  },
                },
                h(
                  'div',
                  { style: { fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  item.title,
                ),
                h(
                  'div',
                  { style: { fontSize: 10, color: colors.muted, marginTop: 1 } },
                  `${item.score} ${t('dock.score')} · ${item.stats?.turns ?? 0} 回合 · ${dayOf(item.updatedAt)}`,
                ),
              ),
            ),
      )

      const detail = h(
        'div',
        { style: { overflow: 'auto', maxHeight: 216, padding: '8px 10px' } },
        entry === undefined
          ? h('div', { style: { fontSize: 12, color: colors.muted } }, t('dock.noDetail'))
          : h(
              'div',
              null,
              h('div', { style: { fontSize: 13, fontWeight: 600, color: colors.text, lineHeight: 1.4 } }, entry.title),
              h(
                'div',
                { style: { fontSize: 10, color: colors.muted, marginTop: 2 } },
                `${entry.score} ${t('dock.score')} · ${entry.stats?.turns ?? 0} 回合 · ${entry.stats?.toolCalls ?? 0} 次工具 · ${dayOf(entry.updatedAt)}`,
              ),
              h('div', { style: { marginTop: 2 } }, ...(entry.flags ?? []).map((flag) => chip(t(`flag.${flag}`), flag === 'user-corrections' || flag === 'tool-errors' ? colors.warn : colors.muted))),
              section(t('dock.goal'), entry.goal),
              section(t('dock.outcome'), entry.outcome),
              adviceList(t('dock.lessons'), entry.lessons, t),
              adviceList(t('dock.promptAdvice'), entry.promptAdvice, t),
              adviceList(t('dock.contextAdvice'), entry.contextAdvice, t),
              entry.deep === undefined
                ? null
                : h(
                    'div',
                    { style: { marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${colors.border}` } },
                    h('div', { style: { fontSize: 11, color: colors.accent, marginBottom: 2 } }, '模型蒸馏'),
                    section(t('dock.goal'), entry.deep.goal),
                    section(t('dock.outcome'), entry.deep.outcome),
                    adviceList('决策', entry.deep.decisions, t),
                    adviceList('失误', entry.deep.mistakes, t),
                    adviceList(t('dock.promptAdvice'), entry.deep.promptImprovements, t),
                    adviceList(t('dock.contextAdvice'), entry.deep.contextImprovements, t),
                    section('可复用模式', entry.deep.reusablePattern),
                    section('摘要', entry.deep.summary),
                  ),
            ),
      )

      const head = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', borderBottom: `1px solid ${colors.border}`, background: colors.layer2 } },
        h(
          'div',
          { style: { fontSize: 11, color: colors.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          `平均 ${data?.stats?.avgScore ?? 0} 分 · ${data?.stats?.totalTurns ?? 0} 回合 · 工具失败率 ${Math.round((data?.stats?.toolErrorRate ?? 0) * 100)}%`,
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h(
            'button',
            {
              type: 'button',
              onClick: () => void scan(),
              disabled: busy !== '',
              style: buttonStyle(busy === 'scan'),
            },
            busy === 'scan' ? t('dock.scanning') : t('dock.refresh'),
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: () => void distillCurrent(false),
              disabled: busy !== '',
              style: buttonStyle(busy === 'distill'),
            },
            busy === 'distill' ? t('dock.distilling') : t('dock.distill'),
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: () => void distillCurrent(true),
              disabled: busy !== '',
              style: buttonStyle(busy === 'deep'),
              title: '调用模型深度蒸馏当前会话，会产生 token 消耗',
            },
            t('dock.deep'),
          ),
          h(
            'a',
            {
              href: 'api/conversation-distillery/export',
              target: '_blank',
              rel: 'noreferrer',
              style: { fontSize: 11, color: colors.accent, textDecoration: 'none' },
            },
            t('dock.export'),
          ),
        ),
      )

      return h(
        'div',
        { style: { width: '100%' } },
        row,
        h(
          'div',
          {
            style: {
              marginTop: 4,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              overflow: 'hidden',
              background: colors.layer,
              color: colors.text,
            },
          },
          head,
          h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(150px, 0.9fr) minmax(0, 1.4fr)' } }, list, detail),
          h('div', { style: { padding: '4px 10px', borderTop: `1px solid ${colors.border}`, fontSize: 10, color: colors.muted } }, t('dock.localOnly')),
        ),
      )
    }

    function buttonStyle(active) {
      return {
        padding: '1px 7px',
        borderRadius: 6,
        border: `1px solid ${colors.border}`,
        background: active ? colors.layer : 'transparent',
        color: colors.text,
        font: 'inherit',
        fontSize: 11,
        cursor: active ? 'default' : 'pointer',
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        let t = (key) => key
        try {
          ctx.effect(() => ctx.locale.register(NAMESPACE, DICTS), 'conversation-distillery: dictionaries')
          t = ctx.locale.bind(NAMESPACE)
        } catch {
          // A locale failure must not blank the dock; fall back to the raw keys.
        }
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'conversation-distillery', order: 40 },
            (props) => h(DistilleryDock, { ...props, translate: t }),
          ),
        )
      },
    }
  },
})
