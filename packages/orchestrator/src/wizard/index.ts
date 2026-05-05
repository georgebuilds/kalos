import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { box, stepHeader, statusLine, dim, cyan, red, indent } from '../tui/format.js'
import { ask, secret, confirm, pressEnter, withSpinner } from '../tui/prompt.js'
import { signAppJwt } from '../github/auth.js'
import { setSetting } from '../db/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../../..')

function mask(value: string): string {
  return value.slice(0, 4) + '••••••••'
}

function writeEnv(updates: Record<string, string>): void {
  const envPath = path.join(PROJECT_ROOT, '.env')
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''

  const lines = existing.split('\n').filter((line) => {
    const eq = line.indexOf('=')
    const key = eq === -1 ? line.trim() : line.slice(0, eq).trim()
    return key ? !Object.keys(updates).includes(key) : true
  })

  const newLines = Object.entries(updates).map(([k, v]) => `${k}=${v}`)
  const result = [...lines.filter((l) => l !== ''), ...newLines].join('\n') + '\n'
  fs.writeFileSync(envPath, result, 'utf8')
}

export async function runWizard(): Promise<void> {
  try {
    await wizard()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stdout.write(`\n${red('Error: ' + msg)}\n`)
    process.exit(1)
  }
}

async function wizard(): Promise<void> {
  // Banner
  process.stdout.write(
    '\n' + box(['🐱  Kalos — First Run Setup', "Let's get you set up in a few steps."]) + '\n\n',
  )

  // ── Step 1: What you'll need ──────────────────────────────────────────────
  process.stdout.write(stepHeader(1, 6, '📋', 'Before you begin'))
  process.stdout.write(
    indent(
      [
        dim("Here's what you'll need to complete setup:"),
        '',
        dim('• An LLM provider API key — or Ollama running locally'),
        dim('• A GitHub account to create a GitHub App'),
        '',
        dim('The wizard will walk you through each step.'),
      ].join('\n'),
    ) + '\n',
  )
  await pressEnter()

  // ── Step 2: LLM Provider ──────────────────────────────────────────────────
  process.stdout.write(stepHeader(2, 6, '🤖', 'Choose LLM Provider'))
  process.stdout.write(
    indent(
      [
        dim('Which provider should Kalos use?'),
        '',
        '  1. Anthropic (default)',
        '  2. OpenRouter',
        '  3. DigitalOcean Gradient',
        '  4. Venice',
        '  5. Ollama (local)',
      ].join('\n'),
    ) + '\n\n',
  )

  const providerChoiceRaw = await ask('Choice [1]')
  const providerChoice = providerChoiceRaw === '' ? '1' : providerChoiceRaw.trim()

  const PROVIDER_MAP: Record<string, string> = {
    '1': 'anthropic',
    '2': 'openrouter',
    '3': 'gradient',
    '4': 'venice',
    '5': 'ollama',
  }

  if (!PROVIDER_MAP[providerChoice]) throw new Error(`Invalid choice: ${providerChoice}`)
  const llmProvider = PROVIDER_MAP[providerChoice]!

  let llmApiKey: string | undefined
  let llmBaseUrl: string | undefined

  if (llmProvider === 'ollama') {
    const baseUrlRaw = await ask('Base URL [http://localhost:11434/api]')
    llmBaseUrl = baseUrlRaw === '' ? 'http://localhost:11434/api' : baseUrlRaw.trim()
  } else {
    const keyLabel = llmProvider === 'anthropic' ? 'Anthropic API key' : 'API key'
    llmApiKey = await secret(`Paste your ${keyLabel}`)

    if (llmProvider === 'anthropic') {
      await withSpinner(
        'Validating API key…',
        async () => {
          const res = await fetch('https://api.anthropic.com/v1/models', {
            headers: { 'x-api-key': llmApiKey! },
            signal: AbortSignal.timeout(15_000),
          })
          if (!res.ok) throw new Error(`API key invalid (HTTP ${res.status})`)
        },
        'API key valid',
      )
    }
  }

  const modelRaw = await ask('Model [leave blank for default]')
  const llmModel = modelRaw.trim() === '' ? undefined : modelRaw.trim()

  await pressEnter()

  // ── Step 3: Create GitHub App ─────────────────────────────────────────────
  process.stdout.write(stepHeader(3, 6, '🐙', 'Create a GitHub App'))
  process.stdout.write(
    indent(
      [
        dim('Kalos needs a GitHub App to clone repos,'),
        dim('push branches, and open pull requests.'),
        '',
        dim('1. Go to:'),
        '   ' + cyan('https://github.com/settings/apps/new'),
        '   ' +
          dim('(or for an org: ') +
          cyan('https://github.com/organizations/ORG/settings/apps/new') +
          dim(')'),
        '',
        dim('2. Fill in:'),
        dim('   • Name:          ') + cyan('anything (e.g. "kalos-agent")'),
        dim('   • Homepage URL:  ') + cyan('http://localhost'),
        dim('   • Webhooks:      ') + cyan('uncheck "Active"'),
        '',
        dim('3. Set these permissions:'),
        dim('   • Contents       →  ') + cyan('Read & Write'),
        dim('   • Pull requests  →  ') + cyan('Read & Write'),
        dim('   • Metadata       →  ') + cyan('Read-only'),
        '',
        dim('4. Click ') + cyan('"Create GitHub App"'),
      ].join('\n'),
    ) + '\n',
  )
  await pressEnter('Press Enter once your app is created')

  // ── Step 4: Configure GitHub App ──────────────────────────────────────────
  process.stdout.write(stepHeader(4, 6, '🔑', 'Configure GitHub App'))
  process.stdout.write(
    indent(
      [
        dim("On your new app's settings page:"),
        '',
        dim('1. Copy the "App ID" at the top of the page'),
        dim('2. Under "Private keys" → click "Generate a private key"'),
        dim('   A .pem file will download automatically'),
        dim('3. In the sidebar click "Install App"'),
        dim('   → Install it on the repos you want Kalos to access'),
      ].join('\n'),
    ) + '\n\n',
  )

  const appIdRaw = await ask('App ID')
  if (!/^\d+$/.test(appIdRaw)) throw new Error('App ID must be numeric')
  const appId = appIdRaw.trim()

  const pemPath = await ask('Path to downloaded .pem file')
  let privateKeyPem: string
  try {
    privateKeyPem = fs.readFileSync(pemPath.trim().replace(/^~/, process.env.HOME ?? '~'), 'utf8')
  } catch {
    throw new Error(`Could not read file: ${pemPath}`)
  }
  if (!privateKeyPem.trimStart().startsWith('-----BEGIN')) {
    throw new Error('File does not look like a valid PEM private key')
  }

  const installationId = await withSpinner(
    'Validating GitHub App…',
    async () => {
      const jwt = signAppJwt(appId, privateKeyPem)
      const res = await fetch('https://api.github.com/app/installations', {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`GitHub API error (HTTP ${res.status})`)
      const data = (await res.json()) as Array<{ id: number }>
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error(
          'No installations found. Make sure you installed the app on at least one repo.',
        )
      }
      return String(data[0]!.id)
    },
    'App validated',
  )

  process.stdout.write(statusLine('✅', 'Installation detected', `ID: ${installationId}`) + '\n')
  await pressEnter()

  // ── Step 5: Configure Webhook (optional) ─────────────────────────────────
  process.stdout.write(stepHeader(5, 6, '🪝', 'Enable PR Reviews (optional)'))
  process.stdout.write(
    indent(
      [
        dim('Kalos can automatically review pull requests'),
        dim('when they are opened.'),
        '',
        dim('To enable:'),
        dim('1. In your GitHub App settings → "Webhook"'),
        dim('   • Check "Active"'),
        dim('   • Set URL: ') + cyan('http://YOUR_SERVER:3000/webhooks/github'),
        dim('   • Content type: ') + cyan('application/json'),
        dim('   • Generate a webhook secret and paste it below'),
      ].join('\n'),
    ) + '\n\n',
  )

  const webhookSecret = await secret('Webhook secret (leave blank to skip)')
  await pressEnter()

  // ── Step 6: Save Configuration ────────────────────────────────────────────
  process.stdout.write(stepHeader(6, 6, '💾', 'Save Configuration'))

  const llmProviderLabel =
    {
      anthropic: 'Anthropic',
      openrouter: 'OpenRouter',
      gradient: 'DigitalOcean Gradient',
      venice: 'Venice',
      ollama: 'Ollama',
    }[llmProvider] ?? llmProvider

  process.stdout.write(
    indent(
      [
        dim('Writing the following to .env:'),
        '',
        `  ${'LLM_PROVIDER'.padEnd(24)} ${llmProviderLabel}`,
        ...(llmApiKey ? [`  ${'LLM_API_KEY'.padEnd(24)} ${mask(llmApiKey)}`] : []),
        ...(llmBaseUrl ? [`  ${'LLM_BASE_URL'.padEnd(24)} ${llmBaseUrl}`] : []),
        ...(llmModel ? [`  ${'LLM_MODEL'.padEnd(24)} ${llmModel}`] : []),
        `  ${'GITHUB_APP_ID'.padEnd(24)} ${appId}`,
        `  ${'GITHUB_APP_PRIVATE_KEY_PATH'.padEnd(24)} kalos.pem (written separately, chmod 600)`,
        `  ${'GITHUB_INSTALLATION_ID'.padEnd(24)} ${installationId}`,
        ...(webhookSecret
          ? [`  ${'GITHUB_WEBHOOK_SECRET'.padEnd(24)} ${mask(webhookSecret)}`]
          : [`  ${'GITHUB_WEBHOOK_SECRET'.padEnd(24)} (skipped)`]),
      ].join('\n'),
    ) + '\n\n',
  )

  const ok = await confirm('Confirm?')
  if (!ok) {
    process.stdout.write('\nSetup cancelled.\n')
    process.exit(0)
  }

  const pemFilePath = path.join(PROJECT_ROOT, 'kalos.pem')
  fs.writeFileSync(pemFilePath, privateKeyPem.trim() + '\n', { mode: 0o600 })

  const envUpdates: Record<string, string> = {
    LLM_PROVIDER: llmProvider,
    GITHUB_APP_ID: appId,
    GITHUB_APP_PRIVATE_KEY_PATH: pemFilePath,
    GITHUB_INSTALLATION_ID: installationId,
  }
  if (llmApiKey) envUpdates.LLM_API_KEY = llmApiKey
  if (llmBaseUrl) envUpdates.LLM_BASE_URL = llmBaseUrl
  if (llmModel) envUpdates.LLM_MODEL = llmModel
  if (webhookSecret) envUpdates.GITHUB_WEBHOOK_SECRET = webhookSecret
  writeEnv(envUpdates)

  setSetting('setup_complete', 'true')
  setSetting('github_installation_id', installationId)
  setSetting('setup_completed_at', new Date().toISOString())

  // Done banner
  process.stdout.write(
    '\n' +
      box(['✅  Kalos is ready']) +
      '\n\n' +
      indent(
        [
          dim('API running at  →  ') + cyan('http://localhost:3000'),
          '',
          dim('Try your first task:'),
          '',
          cyan('curl -X POST http://localhost:3000/tasks \\'),
          cyan('  -H "Content-Type: application/json" \\'),
          cyan('  -d \'{"repo":"org/repo","description":"Your task here"}\''),
        ].join('\n'),
      ) +
      '\n\n',
  )
}
