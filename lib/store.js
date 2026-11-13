/**
 * Durable digest cache.
 *
 * The Session log is the source of truth; this file is a derived cache that
 * survives restarts so a bridge does not re-read every conversation on boot.
 * Writes are serialized and atomic (tmp + rename) because two turns can end at
 * the same time.
 */
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STORE_VERSION = 1
const FILE_NAME = 'library.json'

/** Local calendar day used for the token ledger. */
function today() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Resolve the directory that owns the cache.
 * @param configured - explicit `storeDir` from plugin config.
 * @returns an absolute directory path.
 */
export function resolveStoreDir(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return path.resolve(configured.trim())
  const profile = process.env.DSH_PROFILE_DIR
  if (typeof profile === 'string' && profile.trim() !== '') return path.join(profile, 'conversation-distillery')
  return path.join(os.homedir(), '.dsh', 'conversation-distillery')
}

/** One serialized cache backed by `library.json`. */
export class LibraryStore {
  /**
   * @param directory - directory holding `library.json`.
   */
  constructor(directory) {
    this.directory = directory
    this.file = path.join(directory, FILE_NAME)
    this.data = { version: STORE_VERSION, updatedAt: 0, entries: {}, usage: { date: today(), input: 0, output: 0, calls: 0 } }
    this.loaded = false
    this.queue = Promise.resolve()
  }

  /** Read the cache from disk; a missing or broken file starts empty. */
  async load() {
    try {
      const raw = await fsp.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
        this.data = {
          version: STORE_VERSION,
          updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
          entries: parsed.entries,
          usage:
            parsed.usage && typeof parsed.usage === 'object'
              ? {
                  date: typeof parsed.usage.date === 'string' ? parsed.usage.date : today(),
                  input: Number(parsed.usage.input) || 0,
                  output: Number(parsed.usage.output) || 0,
                  calls: Number(parsed.usage.calls) || 0,
                }
              : { date: today(), input: 0, output: 0, calls: 0 },
        }
      }
    } catch {
      // Missing file is the first run; an unreadable file is replaced on save.
      this.data = { version: STORE_VERSION, updatedAt: 0, entries: {}, usage: { date: today(), input: 0, output: 0, calls: 0 } }
    }
    this.loaded = true
    return this
  }

  /** @returns today's token usage, reset when the local day changes. */
  usageToday() {
    const day = today()
    if (this.data.usage?.date !== day) {
      this.data.usage = { date: day, input: 0, output: 0, calls: 0 }
    }
    return this.data.usage
  }

  /**
   * Add one model call's token usage to today's ledger.
   * @param usage - `{ input, output }` token counts.
   * @returns today's updated ledger.
   */
  addUsage(usage) {
    const ledger = this.usageToday()
    ledger.input += Math.max(0, Number(usage?.input) || 0)
    ledger.output += Math.max(0, Number(usage?.output) || 0)
    ledger.calls += 1
    return ledger
  }

  /** @returns all digest entries. */
  entries() {
    return this.data.entries
  }

  /**
   * @param id - session id.
   * @returns the digest entry, when cached.
   */
  get(id) {
    return this.data.entries[id]
  }

  /** @returns entries sorted newest first. */
  list() {
    return Object.values(this.data.entries).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }

  /**
   * Insert or replace one digest entry.
   * @param entry - digest entry with an `id`.
   * @returns the stored entry.
   */
  upsert(entry) {
    this.data.entries[entry.id] = entry
    return entry
  }

  /**
   * Forget entries whose session no longer exists.
   * @param liveIds - ids still present in the corpus.
   * @returns how many entries were dropped.
   */
  prune(liveIds) {
    const keep = new Set(liveIds)
    let dropped = 0
    for (const id of Object.keys(this.data.entries)) {
      if (!keep.has(id)) {
        delete this.data.entries[id]
        dropped += 1
      }
    }
    return dropped
  }

  /** Serialize one atomic write. */
  async save() {
    const write = async () => {
      this.data.updatedAt = Date.now()
      await fsp.mkdir(this.directory, { recursive: true })
      const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`
      const body = JSON.stringify(this.data)
      await fsp.writeFile(temporary, body, 'utf8')
      await fsp.rename(temporary, this.file)
    }
    const next = this.queue.then(write, write)
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Write the human-readable Markdown report next to the cache. */
  async writeReport(markdown) {
    await fsp.mkdir(this.directory, { recursive: true })
    const file = path.join(this.directory, 'report.md')
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
    await fsp.writeFile(temporary, markdown, 'utf8')
    await fsp.rename(temporary, file)
    return file
  }
}
