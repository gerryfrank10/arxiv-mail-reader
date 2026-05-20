import { AIConfig, AIProfileSlot, AIProvider, AIPurpose, Settings } from '../types';
import { _aiActivityFinish, _aiActivityStart } from '../contexts/AIActivityContext';

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

// Derive the legacy single-provider config: prefer settings.ai, otherwise
// translate the legacy claudeApiKey field. Used as a fallback when
// aiProfiles isn't configured.
export function resolveAIConfig(s: Settings | undefined): AIConfig {
  // If two-tier profiles are set, expose the premium one (or default) as
  // the "primary" config for backward-compatible callers like the header
  // badge that just wants to display "provider name".
  if (s?.aiProfiles?.premium?.provider) return s.aiProfiles.premium;
  if (s?.aiProfiles?.default?.provider) return s.aiProfiles.default;
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

// =========================================================================
// Two-tier routing
// =========================================================================

/** Sensible defaults: bulk/high-volume → 'default' (cheap/local),
 *  user-triggered quality work → 'premium' (cloud/best). */
const DEFAULT_ROUTING: Record<AIPurpose, AIProfileSlot> = {
  'tracker-score':       'default',
  'magazine-editorial':  'premium',
  'paper-summary':       'premium',
  'ai-suggest':          'premium',
  'writer-cite-suggest': 'premium',
  'connection-test':     'default',
  'chat':                'default',
};

/** Returns the AIConfig the given purpose should run on, with graceful
 *  fallback: if the preferred tier is unset, falls back to the other tier,
 *  then to the legacy single-config, then to 'none'. */
export function resolveProfileForPurpose(s: Settings | undefined, purpose: string | undefined): { config: AIConfig; slot: AIProfileSlot | 'legacy' | 'none' } {
  const profiles = s?.aiProfiles;
  // If no profiles configured at all, fall back to legacy single-config.
  if (!profiles?.default && !profiles?.premium) {
    const c = resolveAIConfig(s);
    return { config: c, slot: c.provider === 'none' ? 'none' : 'legacy' };
  }
  const requested: AIProfileSlot =
    (purpose ? s?.aiRouting?.[purpose as AIPurpose] : undefined) ??
    DEFAULT_ROUTING[purpose as AIPurpose] ??
    'default';
  const primary = profiles[requested];
  if (primary?.provider && primary.provider !== 'none') return { config: primary, slot: requested };
  // Fallback to the other tier
  const other: AIProfileSlot = requested === 'premium' ? 'default' : 'premium';
  const fallback = profiles[other];
  if (fallback?.provider && fallback.provider !== 'none') return { config: fallback, slot: other };
  return { config: { provider: 'none' }, slot: 'none' };
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
  /** A short label so the activity log can group calls — e.g. 'tracker-score',
   *  'magazine-editorial', 'paper-summary', 'ai-suggest', 'connection-test'. */
  purpose?: string;
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
  // Route by purpose. When the user has two-tier profiles set up, this is
  // the difference between burning Claude tokens on every tracker tick
  // vs running them locally through Ollama.
  const { config, slot } = resolveProfileForPurpose(settings, opts.purpose);
  if (config.provider === 'none') {
    throw new Error('No AI provider configured. Open Settings and pick a provider.');
  }
  if (config.provider !== 'ollama' && !config.apiKey) {
    throw new Error(`No API key for ${providerLabel(config)} (${slot} profile).`);
  }

  const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  const maxTokens = opts.maxTokens ?? 1024;
  const temperature = opts.temperature ?? 0.4;
  const promptChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);

  const actId = _aiActivityStart({
    purpose:  opts.purpose ?? 'chat',
    provider: config.provider,
    model:    config.model,
    profile:  slot,
    promptChars,
  });

  try {
    const text = config.provider === 'claude'
      ? await callClaude(messages, config, { maxTokens, temperature, signal })
      : await callOpenAICompatible(messages, config, { maxTokens, temperature, signal });
    _aiActivityFinish(actId, { status: 'success', responseChars: text.length });
    return text;
  } catch (e) {
    const err = e as Error;
    // Distinguish abort/cancellation from real failures so the activity log
    // can show e.g. NS_BINDING_ABORTED as 'cancelled' rather than 'error'.
    const isAbort =
      err?.name === 'AbortError' ||
      err?.name === 'TimeoutError' ||
      /aborted|NS_BINDING_ABORTED/i.test(err?.message ?? '');
    _aiActivityFinish(actId, {
      status: isAbort ? 'cancelled' : 'error',
      error:  err?.message ?? 'unknown error',
    });
    throw e;
  }
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

// =========================================================================
// List available models from a provider so the user doesn't have to type
// the model name. For Ollama we hit /api/tags (no auth); for everything
// else we hit GET /v1/models with the Bearer key.
// =========================================================================

export async function listAvailableModels(config: AIConfig): Promise<string[]> {
  if (config.provider === 'none') return [];
  if (config.provider === 'ollama') {
    const base = (config.baseUrl || AI_DEFAULTS.ollama.baseUrl || '').replace(/\/v1\/?$/, '');
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`Ollama list-models ${r.status}`);
    const data = await r.json() as { models?: Array<{ name?: string }> };
    return (data.models ?? []).map(m => m.name ?? '').filter(Boolean).sort();
  }
  if (config.provider === 'claude') {
    // Anthropic doesn't expose a list-models endpoint as part of the v1 API,
    // so return the well-known IDs.
    return [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ];
  }
  // OpenAI-compatible (OpenAI, Groq, custom, …)
  const baseUrl = config.baseUrl || AI_DEFAULTS[config.provider]?.baseUrl;
  if (!baseUrl) throw new Error(`No base URL for ${config.provider}`);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
  const r = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`${config.provider} list-models ${r.status}`);
  const data = await r.json() as { data?: Array<{ id?: string }> };
  return (data.data ?? []).map(m => m.id ?? '').filter(Boolean).sort();
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
