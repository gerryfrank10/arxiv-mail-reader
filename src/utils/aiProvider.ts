import { AIConfig, AIProvider, Settings } from '../types';

// Sensible defaults so the user only needs to pick a provider + paste a key
export const AI_DEFAULTS: Record<AIProvider, { baseUrl?: string; model?: string; label: string; help: string }> = {
  claude:  {
    baseUrl: 'https://api.anthropic.com/v1',
    model:   'claude-haiku-4-5-20251001',
    label:   'Claude (Anthropic)',
    help:    'Paste your key from console.anthropic.com',
  },
  openai:  {
    baseUrl: 'https://api.openai.com/v1',
    model:   'gpt-4o-mini',
    label:   'OpenAI',
    help:    'Paste your key from platform.openai.com',
  },
  groq:    {
    baseUrl: 'https://api.groq.com/openai/v1',
    model:   'llama-3.3-70b-versatile',
    label:   'Groq (free tier)',
    help:    'Free key at console.groq.com — very fast, generous free limits',
  },
  ollama:  {
    baseUrl: 'http://localhost:11434/v1',
    model:   'llama3.1',
    label:   'Ollama (local)',
    help:    'Free, runs locally. Install from ollama.com and run `ollama pull llama3.1` first.',
  },
  custom:  {
    baseUrl: 'http://localhost:8080/v1',
    model:   'local-model',
    label:   'Custom (OpenAI-compatible)',
    help:    'Any OpenAI-compatible endpoint (LM Studio, vLLM, etc.).',
  },
  none:    {
    label:   'No AI provider',
    help:    'AI features will be disabled; tracker scoring falls back to keyword matching.',
  },
};

export const AI_PROVIDERS: AIProvider[] = ['claude', 'openai', 'groq', 'ollama', 'custom', 'none'];

// Derive the effective config: prefer settings.ai, otherwise translate the
// legacy claudeApiKey field into a Claude config so old keys keep working.
export function resolveAIConfig(s: Settings | undefined): AIConfig {
  if (s?.ai && s.ai.provider) return s.ai;
  if (s?.claudeApiKey)        return { provider: 'claude', apiKey: s.claudeApiKey };
  return { provider: 'none' };
}

export function hasAI(s: Settings | undefined): boolean {
  const c = resolveAIConfig(s);
  if (c.provider === 'none') return false;
  if (c.provider === 'ollama') return true; // no key needed
  return !!c.apiKey;
}

export function providerLabel(c: AIConfig): string {
  return AI_DEFAULTS[c.provider]?.label ?? c.provider;
}

// =========================================================================
// Unified chat completion
// =========================================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  /** Abort signal forwarded to fetch */
  signal?: AbortSignal;
  /** Approximate timeout in ms (used when no signal is supplied) */
  timeoutMs?: number;
}

/**
 * Call the configured AI provider and return the text response.
 *
 * Claude runs direct from the browser (Anthropic supports CORS for this).
 * All other providers are proxied through our server's /api/ai/chat to
 * avoid browser CORS issues (especially for Ollama on localhost).
 */
export async function aiChat(
  messages: ChatMessage[],
  settings: Settings | undefined,
  opts: ChatOptions = {},
): Promise<string> {
  const config = resolveAIConfig(settings);
  if (config.provider === 'none') {
    throw new Error('No AI provider configured. Open Settings and pick a provider.');
  }
  if (config.provider !== 'ollama' && !config.apiKey) {
    throw new Error(`No API key for ${providerLabel(config)}.`);
  }

  const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  const maxTokens = opts.maxTokens ?? 1024;
  const temperature = opts.temperature ?? 0.4;

  if (config.provider === 'claude') {
    return callClaude(messages, config, { maxTokens, temperature, signal });
  }
  // Everything else is OpenAI-compatible, proxied through our server.
  return callOpenAICompatible(messages, config, { maxTokens, temperature, signal });
}

async function callClaude(
  messages: ChatMessage[],
  config: AIConfig,
  opts: { maxTokens: number; temperature: number; signal: AbortSignal },
): Promise<string> {
  // Anthropic separates system from user messages — combine them if present
  const systemMsg = messages.find(m => m.role === 'system')?.content;
  const rest      = messages.filter(m => m.role !== 'system');
  const baseUrl   = config.baseUrl || AI_DEFAULTS.claude.baseUrl;
  const model     = config.model   || AI_DEFAULTS.claude.model;

  const resp = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey!,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens:  opts.maxTokens,
      temperature: opts.temperature,
      ...(systemMsg ? { system: systemMsg } : {}),
      messages: rest.map(m => ({ role: m.role, content: m.content })),
    }),
    signal: opts.signal,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Claude API ${resp.status}`);
  }
  const data = await resp.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text ?? '';
}

async function callOpenAICompatible(
  messages: ChatMessage[],
  config: AIConfig,
  opts: { maxTokens: number; temperature: number; signal: AbortSignal },
): Promise<string> {
  const baseUrl = config.baseUrl || AI_DEFAULTS[config.provider]?.baseUrl;
  const model   = config.model   || AI_DEFAULTS[config.provider]?.model;
  if (!baseUrl) throw new Error(`No base URL for provider ${config.provider}`);
  if (!model)   throw new Error(`No model for provider ${config.provider}`);

  // Proxy through our server to avoid CORS (especially for Ollama on localhost)
  const resp = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: config.provider,
      baseUrl,
      apiKey:   config.apiKey ?? '',
      model,
      messages,
      maxTokens:  opts.maxTokens,
      temperature: opts.temperature,
    }),
    signal: opts.signal,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `AI proxy error ${resp.status}`);
  }
  const data = await resp.json() as { text: string };
  return data.text ?? '';
}
