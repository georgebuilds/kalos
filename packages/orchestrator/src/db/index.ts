import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config.js'

const dbPath = config.databaseUrl
const dbDir = dirname(dbPath)
if (dbDir !== '.') mkdirSync(dbDir, { recursive: true })

const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  base_branch TEXT NOT NULL DEFAULT 'main',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  branch TEXT,
  pr_url TEXT,
  container_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT,
  ci_fix_attempts INTEGER NOT NULL DEFAULT 0,
  parent_task_id TEXT,
  model_id TEXT
);

CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  line TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pr_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  pull_number INTEGER NOT NULL,
  sha TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL
);

-- Per-repo overrides for the global default model. Keyed on the same
-- "owner/repo" string used elsewhere in the schema.
CREATE TABLE IF NOT EXISTS repo_settings (
  repo TEXT PRIMARY KEY,
  model_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_branch ON tasks(branch);
CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_pr_reviews_repo ON pr_reviews(repo, pull_number);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_ts ON webhook_deliveries(ts);
`)

try { db.exec('ALTER TABLE tasks ADD COLUMN ci_fix_attempts INTEGER NOT NULL DEFAULT 0') } catch {}
try { db.exec('ALTER TABLE tasks ADD COLUMN parent_task_id TEXT') } catch {}
try { db.exec('ALTER TABLE tasks ADD COLUMN model_id TEXT') } catch {}

const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const cleanupStmts = {
  deleteOldLogs: db.prepare('DELETE FROM task_logs WHERE ts < ?'),
  deleteOldTasks: db.prepare(
    'DELETE FROM tasks WHERE completed_at IS NOT NULL AND completed_at < ?',
  ),
}

export function cleanupOldData(): void {
  const cutoff = Date.now() - LOG_RETENTION_MS
  const deletedLogs = cleanupStmts.deleteOldLogs.run(cutoff).changes
  const deletedTasks = cleanupStmts.deleteOldTasks.run(cutoff).changes
  if (deletedLogs > 0 || deletedTasks > 0) {
    console.log(
      `[db] pruned ${deletedLogs} log rows and ${deletedTasks} completed tasks older than 30 days`,
    )
  }
}

cleanupOldData()

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const

export type Task = {
  id: string
  repo: string
  baseBranch: string
  description: string
  status: TaskStatus
  branch: string | null
  prUrl: string | null
  containerId: string | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
  error: string | null
  ciFixAttempts: number
  parentTaskId: string | null
  modelId: string | null
}

export type TaskLog = {
  id: number
  taskId: string
  line: string
  ts: number
}

const camelToSnakeMap: Record<keyof Omit<Task, 'id' | 'createdAt'>, string> = {
  repo: 'repo',
  baseBranch: 'base_branch',
  description: 'description',
  status: 'status',
  branch: 'branch',
  prUrl: 'pr_url',
  containerId: 'container_id',
  updatedAt: 'updated_at',
  completedAt: 'completed_at',
  error: 'error',
  ciFixAttempts: 'ci_fix_attempts',
  parentTaskId: 'parent_task_id',
  modelId: 'model_id',
}

function toSnakeCase(key: string): string {
  return (camelToSnakeMap as Record<string, string>)[key] ?? key
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    repo: row.repo as string,
    baseBranch: row.base_branch as string,
    description: row.description as string,
    status: row.status as TaskStatus,
    branch: row.branch as string | null,
    prUrl: row.pr_url as string | null,
    containerId: row.container_id as string | null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    completedAt: row.completed_at as number | null,
    error: row.error as string | null,
    ciFixAttempts: (row.ci_fix_attempts as number) ?? 0,
    parentTaskId: row.parent_task_id as string | null,
    modelId: (row.model_id as string | null) ?? null,
  }
}

function rowToTaskLog(row: Record<string, unknown>): TaskLog {
  return {
    id: row.id as number,
    taskId: row.task_id as string,
    line: row.line as string,
    ts: row.ts as number,
  }
}

const stmts = {
  insertTask: db.prepare(`
    INSERT INTO tasks (id, repo, base_branch, description, branch, ci_fix_attempts, parent_task_id, model_id, created_at, updated_at)
    VALUES ($id, $repo, $base_branch, $description, $branch, $ci_fix_attempts, $parent_task_id, $model_id, $created_at, $updated_at)
  `),
  getTask: db.prepare(`SELECT * FROM tasks WHERE id = ?`),
  getTaskByBranch: db.prepare(`SELECT * FROM tasks WHERE branch = ? ORDER BY created_at DESC LIMIT 1`),
  getPending: db.prepare(`SELECT * FROM tasks WHERE status = 'pending'`),
  getNextPending: db.prepare(
    `SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`,
  ),
  getRunning: db.prepare(`SELECT * FROM tasks WHERE status = 'running'`),
  getRunningCount: db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE status = 'running'`),
  insertLog: db.prepare(`INSERT INTO task_logs (task_id, line, ts) VALUES ($task_id, $line, $ts)`),
  getLogs: db.prepare(`SELECT * FROM task_logs WHERE task_id = ? ORDER BY id ASC`),
  getLogsSince: db.prepare(`SELECT * FROM task_logs WHERE task_id = ? AND id > ? ORDER BY id ASC`),
  getLogsTail: db.prepare(`SELECT * FROM task_logs WHERE task_id = ? ORDER BY id DESC LIMIT ?`),
  getRecentTasks: db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?`),
  insertPrReview: db.prepare(
    `INSERT INTO pr_reviews (repo, pull_number, sha, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ),
}

export function insertTask(task: {
  id: string
  repo: string
  baseBranch: string
  description: string
  branch?: string
  ciFixAttempts?: number
  parentTaskId?: string
  modelId?: string | null
}): void {
  const now = Date.now()
  stmts.insertTask.run({
    id: task.id,
    repo: task.repo,
    base_branch: task.baseBranch,
    description: task.description,
    branch: task.branch ?? null,
    ci_fix_attempts: task.ciFixAttempts ?? 0,
    parent_task_id: task.parentTaskId ?? null,
    model_id: task.modelId ?? null,
    created_at: now,
    updated_at: now,
  })
}

export function getTaskByBranch(branch: string): Task | undefined {
  const row = stmts.getTaskByBranch.get(branch) as Record<string, unknown> | undefined
  return row ? rowToTask(row) : undefined
}

export function getTask(id: string): Task | undefined {
  const row = stmts.getTask.get(id) as Record<string, unknown> | undefined
  return row ? rowToTask(row) : undefined
}

export function updateTask(id: string, updates: Partial<Omit<Task, 'id' | 'createdAt'>>): void {
  const merged = { ...updates, updatedAt: Date.now() }
  const params: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(merged)) {
    params[toSnakeCase(k)] = v
  }
  const setClauses = Object.keys(params)
    .map((k) => `${k} = $${k}`)
    .join(', ')
  params.id = id
  // Fresh prepare per call because the column set varies. Cache key would be
  // Object.keys(updates).sort().join(',') if this becomes a hotspot.
  db.prepare(`UPDATE tasks SET ${setClauses} WHERE id = $id`).run(params)
}

export function getPendingTasks(): Task[] {
  return (stmts.getPending.all() as Record<string, unknown>[]).map(rowToTask)
}

export function getRunningTasks(): Task[] {
  return (stmts.getRunning.all() as Record<string, unknown>[]).map(rowToTask)
}

export function insertLog(taskId: string, line: string): void {
  stmts.insertLog.run({ task_id: taskId, line, ts: Date.now() })
}

export function getLogsForTask(taskId: string): TaskLog[] {
  return (stmts.getLogs.all(taskId) as Record<string, unknown>[]).map(rowToTaskLog)
}

export function getLogsForTaskSince(taskId: string, afterId: number): TaskLog[] {
  return (stmts.getLogsSince.all(taskId, afterId) as Record<string, unknown>[]).map(rowToTaskLog)
}

export function getLogTailForTask(taskId: string, limit: number): TaskLog[] {
  const rows = (stmts.getLogsTail.all(taskId, limit) as Record<string, unknown>[]).map(rowToTaskLog)
  return rows.reverse()
}

export function appendLogs(taskId: string, rawLogs: string): void {
  const lines = rawLogs.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0) return
  const now = Date.now()
  const insertMany = db.transaction(() => {
    for (const line of lines) {
      stmts.insertLog.run({ task_id: taskId, line, ts: now })
    }
  })
  insertMany()
}

const settingStmts = {
  get: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  set: db.prepare(
    `INSERT INTO settings (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = $value`,
  ),
}

export function getSetting(key: string): string | null {
  const row = settingStmts.get.get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  settingStmts.set.run({ key, value })
}

export function isSetupComplete(): boolean {
  return getSetting('setup_complete') === 'true'
}

export function getRecentTasks(limit = 20): Task[] {
  return (stmts.getRecentTasks.all(limit) as Record<string, unknown>[]).map(rowToTask)
}

export function getRunningTaskCount(): number {
  const row = stmts.getRunningCount.get() as { count: number }
  return row.count
}

export function getNextPendingTask(): Task | null {
  const row = stmts.getNextPending.get() as Record<string, unknown> | undefined
  return row ? rowToTask(row) : null
}

export function insertPrReview(review: {
  repo: string
  pullNumber: number
  sha: string
  status: 'success' | 'failed'
  error?: string
}): void {
  stmts.insertPrReview.run(
    review.repo,
    review.pullNumber,
    review.sha,
    review.status,
    review.error ?? null,
    Date.now(),
  )
}

const webhookStmts = {
  insert: db.prepare(`INSERT OR IGNORE INTO webhook_deliveries (delivery_id, ts) VALUES (?, ?)`),
  prune: db.prepare(`DELETE FROM webhook_deliveries WHERE ts < ?`),
}

const WEBHOOK_DEDUP_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Records a delivery; returns true if newly recorded, false if it was already seen.
export function tryRecordWebhookDelivery(deliveryId: string): boolean {
  const result = webhookStmts.insert.run(deliveryId, Date.now())
  if (result.changes === 0) return false
  // Opportunistic prune (~1% of inserts) to keep the table bounded.
  if (Math.random() < 0.01) {
    webhookStmts.prune.run(Date.now() - WEBHOOK_DEDUP_TTL_MS)
  }
  return true
}

// ── Repo settings ────────────────────────────────────────────────────────────

export type RepoSettings = {
  repo: string
  modelId: string | null
}

const repoSettingsStmts = {
  get: db.prepare(`SELECT repo, model_id FROM repo_settings WHERE repo = ?`),
  upsert: db.prepare(
    `INSERT INTO repo_settings (repo, model_id) VALUES ($repo, $model_id)
     ON CONFLICT(repo) DO UPDATE SET model_id = $model_id`,
  ),
  delete: db.prepare(`DELETE FROM repo_settings WHERE repo = ?`),
  list: db.prepare(`SELECT repo, model_id FROM repo_settings ORDER BY repo`),
}

export function getRepoSettings(repo: string): RepoSettings | null {
  const row = repoSettingsStmts.get.get(repo) as { repo: string; model_id: string | null } | undefined
  if (!row) return null
  return { repo: row.repo, modelId: row.model_id ?? null }
}

export function setRepoModelId(repo: string, modelId: string | null): void {
  repoSettingsStmts.upsert.run({ repo, model_id: modelId })
}

export function clearRepoSettings(repo: string): void {
  repoSettingsStmts.delete.run(repo)
}

export function listRepoSettings(): RepoSettings[] {
  const rows = repoSettingsStmts.list.all() as { repo: string; model_id: string | null }[]
  return rows.map((r) => ({ repo: r.repo, modelId: r.model_id ?? null }))
}

// ── Default model (lives in `settings` under a fixed key) ───────────────────

const DEFAULT_MODEL_KEY = 'default_model_id'

export function getDefaultModelId(): string | null {
  return getSetting(DEFAULT_MODEL_KEY)
}

export function setDefaultModelId(id: string): void {
  setSetting(DEFAULT_MODEL_KEY, id)
}

// ── Recent tasks with optional status filter ─────────────────────────────────

const tasksByStatusBaseSql = `SELECT * FROM tasks`

export function getRecentTasksFiltered(
  statuses: TaskStatus[] | null,
  limit = 20,
): Task[] {
  // No filter → fall back to the simple recent query.
  if (!statuses || statuses.length === 0) {
    return getRecentTasks(limit)
  }
  const placeholders = statuses.map(() => '?').join(',')
  const sql = `${tasksByStatusBaseSql} WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`
  const rows = db.prepare(sql).all(...statuses, limit) as Record<string, unknown>[]
  return rows.map(rowToTask)
}
