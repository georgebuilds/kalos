import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

const PROVIDER_DEFAULTS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-5',
  openrouter: 'anthropic/claude-sonnet-4-5',
  gradient: 'claude-3-5-sonnet',
  venice: 'claude-3-5-sonnet',
  ollama: 'llama3',
}

const PROVIDER_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  gradient: 'https://inference.do-ai.run/v1',
  venice: 'https://api.venice.ai/api/v1',
  ollama: 'http://localhost:11434/api',
}

export function getModel(): LanguageModel {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic'
  const model = process.env.LLM_MODEL ?? PROVIDER_DEFAULTS[provider]
  const apiKey = process.env.LLM_API_KEY
  const baseURL = process.env.LLM_BASE_URL ?? PROVIDER_URLS[provider]

  if (!model) throw new Error(`No default model for provider: ${provider}`)

  if (provider === 'anthropic') {
    if (!apiKey) throw new Error('LLM_API_KEY is required for anthropic provider')
    const anthropic = createAnthropic({ apiKey })
    return anthropic(model)
  }

  // All other providers are OpenAI-compatible
  if (!baseURL) throw new Error(`LLM_BASE_URL is required for provider: ${provider}`)
  if (provider !== 'ollama' && !apiKey) {
    throw new Error(`LLM_API_KEY is required for provider: ${provider}`)
  }

  const openai = createOpenAI({
    baseURL,
    apiKey: apiKey ?? 'ollama', // ollama doesn't validate the key
  })

  return openai(model)
}
