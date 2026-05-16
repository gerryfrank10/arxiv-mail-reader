import { useState, useEffect, useMemo } from 'react';
import { X, Mail, Hash, RefreshCw, Key, Eye, EyeOff, Cpu, ChevronDown, ExternalLink, CheckCircle2, AlertCircle, Loader2, Database, UploadCloud } from 'lucide-react';
import { usePapers } from '../contexts/PapersContext';
import { AI_DEFAULTS, AI_PROVIDERS, resolveAIConfig } from '../utils/aiProvider';
import { AIProvider, AIConfig } from '../types';
import { dbExportAll } from '../utils/paperDb';
import { getDbStatus, migrateFromIdb } from '../utils/researchApi';
import { getStorageMode, setStorageMode } from '../utils/storage';
import { useConfirm } from '../contexts/ConfirmContext';
import { useCorrelations } from '../contexts/CorrelationsContext';
import { Brain } from 'lucide-react';

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const { settings, updateSettings, sync } = usePapers();
  const [senderEmail, setSenderEmail] = useState(settings.senderEmail);
  const [maxEmails,   setMaxEmails]   = useState(settings.maxEmails);
  const [s2Key,       setS2Key]       = useState(settings.s2ApiKey ?? '');
  const [showS2,      setShowS2]      = useState(false);

  // ----- AI provider state (drives the whole picker) -----
  const initialAi = useMemo<AIConfig>(() => {
    const r = resolveAIConfig(settings);
    return {
      provider: r.provider,
      apiKey:   r.apiKey ?? '',
      baseUrl:  r.baseUrl ?? AI_DEFAULTS[r.provider]?.baseUrl,
      model:    r.model   ?? AI_DEFAULTS[r.provider]?.model,
    };
  }, [settings]);

  const [provider, setProvider] = useState<AIProvider>(initialAi.provider);
  const [apiKey,   setApiKey]   = useState(initialAi.apiKey ?? '');
  const [baseUrl,  setBaseUrl]  = useState(initialAi.baseUrl ?? '');
  const [model,    setModel]    = useState(initialAi.model ?? '');
  const [showKey,  setShowKey]  = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    setSenderEmail(settings.senderEmail);
    setMaxEmails(settings.maxEmails);
    setS2Key(settings.s2ApiKey ?? '');
    const r = resolveAIConfig(settings);
    setProvider(r.provider);
    setApiKey(r.apiKey ?? '');
    setBaseUrl(r.baseUrl ?? AI_DEFAULTS[r.provider]?.baseUrl ?? '');
    setModel(r.model ?? AI_DEFAULTS[r.provider]?.model ?? '');
  }, [settings]);

  // When the user picks a new provider, fill in defaults
  function pickProvider(p: AIProvider) {
    setProvider(p);
    setBaseUrl(AI_DEFAULTS[p]?.baseUrl ?? '');
    setModel(AI_DEFAULTS[p]?.model ?? '');
    setTestResult(null);
    if (p === 'ollama' || p === 'none') setApiKey('');
  }

  const def = AI_DEFAULTS[provider];
  const needsKey  = provider !== 'ollama' && provider !== 'none';
  const showAdv   = provider !== 'claude' && provider !== 'none';

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      // Save the current values temporarily so aiChat resolves correctly,
      // BUT don't persist until the user clicks Save. Just call directly:
      const { aiChat } = await import('../utils/aiProvider');
      const config: AIConfig = { provider, apiKey, baseUrl, model };
      // Build a transient settings object for the call only
      const transientSettings = { ...settings, ai: config };
      const text = await aiChat(
        [{ role: 'user', content: 'Reply with just the word "ok".' }],
        transientSettings,
        { maxTokens: 8, temperature: 0, timeoutMs: 20_000 },
      );
      setTestResult({ ok: true, message: `Connected. Replied: "${text.trim().slice(0, 40)}"` });
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    const ai: AIConfig | undefined = provider === 'none'
      ? { provider: 'none' }
      : {
          provider,
          apiKey:  needsKey ? (apiKey.trim() || undefined) : undefined,
          baseUrl: baseUrl.trim() || undefined,
          model:   model.trim()   || undefined,
        };
    updateSettings({
      senderEmail,
      maxEmails,
      // Keep legacy field in sync when user is on Claude (so older code paths work)
      claudeApiKey: provider === 'claude' && apiKey.trim() ? apiKey.trim() : undefined,
      s2ApiKey:     s2Key.trim() || undefined,
      ai,
    });
    onClose();
    setTimeout(() => sync(true), 100);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 max-h-[92vh] overflow-y-auto fade-in">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-800">Settings</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-6">
          {/* ---------- Email ---------- */}
          <Section title="Email & sync">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Sender email to parse</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={senderEmail}
                  onChange={e => setSenderEmail(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
                  placeholder="no-reply@arxiv.org"
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                <button onClick={() => setSenderEmail('no-reply@arxiv.org')} className="text-blue-400 hover:underline">no-reply@arxiv.org</button>
                {' '}·{' '}
                <button onClick={() => setSenderEmail('cs@arxiv.org')} className="text-blue-400 hover:underline">cs@arxiv.org</button>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Max emails to fetch</label>
              <div className="relative">
                <Hash size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="number" min={5} max={100}
                  value={maxEmails}
                  onChange={e => setMaxEmails(Number(e.target.value))}
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-400">Higher values fetch more history (5–100).</p>
            </div>
          </Section>

          {/* ---------- AI provider ---------- */}
          <Section title="AI provider"
            description="Used for tracker scoring, paper summaries, and inbox suggestions. Pick free/local Ollama, free-tier Groq, or any OpenAI-compatible endpoint.">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                <Cpu size={13} className="text-blue-500" />
                Provider
              </label>
              <div className="relative">
                <select
                  value={provider}
                  onChange={e => pickProvider(e.target.value as AIProvider)}
                  className="w-full pl-3 pr-9 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all appearance-none"
                >
                  {AI_PROVIDERS.map(p => (
                    <option key={p} value={p}>{AI_DEFAULTS[p].label}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
              <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">{def?.help}</p>
            </div>

            {needsKey && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <Key size={13} className="text-slate-400" />
                  API key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={provider === 'claude' ? 'sk-ant-…' : provider === 'openai' ? 'sk-…' : provider === 'groq' ? 'gsk_…' : 'your api key'}
                    className="w-full pl-3 pr-10 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            )}

            {showAdv && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Base URL</label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                    placeholder={def?.baseUrl}
                    className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Model</label>
                  <input
                    type="text"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder={def?.model}
                    className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
                  />
                </div>
              </div>
            )}

            {provider !== 'none' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTest}
                  disabled={testing || (needsKey && !apiKey.trim())}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  {testing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                {testResult && (
                  <span className={`text-xs flex items-center gap-1 ${testResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {testResult.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                    {testResult.message}
                  </span>
                )}
              </div>
            )}

            {provider === 'ollama' && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 leading-relaxed">
                <strong className="text-slate-700">Ollama quick start:</strong><br />
                1. Install from <a href="https://ollama.com" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-0.5">ollama.com <ExternalLink size={10} /></a><br />
                2. Pull a model: <code className="px-1 py-0.5 bg-white rounded border border-slate-200 font-mono">ollama pull llama3.1</code><br />
                3. Click <em>Test connection</em>
              </div>
            )}
          </Section>

          {/* ---------- IndexedDB → Postgres migration ---------- */}
          <MigrationSection />

          {/* ---------- AI correlations cache ---------- */}
          <CorrelationsSection />

          {/* ---------- Semantic Scholar ---------- */}
          <Section title="Semantic Scholar (optional)" description="Raises rate limits 10x for Discover & citation-graph features.">
            <div className="relative">
              <input
                type={showS2 ? 'text' : 'password'}
                value={s2Key}
                onChange={e => setS2Key(e.target.value)}
                placeholder="(leave blank to use the free tier)"
                className="w-full pl-3 pr-10 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400 transition-all"
              />
              <button type="button" onClick={() => setShowS2(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showS2 ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Get a personal key at <a href="https://www.semanticscholar.org/product/api#api-key-form" target="_blank" rel="noreferrer" className="text-emerald-500 hover:underline">semanticscholar.org/product/api</a>.
            </p>
          </Section>
        </div>

        <div className="mt-7 flex gap-3">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <RefreshCw size={14} />
            Save & Sync
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">{title}</h3>
      {description && <p className="text-xs text-slate-500 mb-3 leading-relaxed">{description}</p>}
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

// =========================================================================
// IndexedDB → Postgres migration UI
// =========================================================================

interface IdbStats { papers: number; trackers: number; scores: number; readIds: number; }

function MigrationSection() {
  const [dbStatus, setDbStatus] = useState<{ enabled: boolean } | null>(null);
  const [idbStats, setIdbStats] = useState<IdbStats | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [migratedAt, setMigratedAt] = useState<string | null>(() => localStorage.getItem('arxiv_idb_migrated_at'));
  const [mode, setMode]           = useState(getStorageMode());
  const confirm = useConfirm();

  useEffect(() => {
    (async () => {
      try { setDbStatus(await getDbStatus()); } catch { setDbStatus({ enabled: false }); }
      try {
        const exp = await dbExportAll();
        setIdbStats({ papers: exp.papers.length, trackers: exp.trackers.length, scores: exp.scores.length, readIds: exp.readIds.length });
      } catch { /* IDB unavailable */ }
    })();
  }, []);

  async function handleMigrate() {
    const ok = await confirm({
      title: 'Push local data to server?',
      message: 'Every paper, tracker, score, read state, and library save in your browser will be sent to Postgres. The operation is idempotent — re-running won\'t create duplicates.',
      confirmLabel: 'Push to server',
      tone: 'info',
    });
    if (!ok) return;
    setMigrating(true);
    setResult(null);
    try {
      const exp = await dbExportAll();
      const payload = {
        papers:   exp.papers,
        library:  [] as string[],
        readIds:  exp.readIds,
        trackers: exp.trackers,
        scores:   exp.scores,
      };
      // Pull library (saved-paper ids) — try both the new compact key and
      // the legacy full-object key.
      try {
        const compact = localStorage.getItem('arxiv_reader_library_ids');
        if (compact) {
          payload.library = JSON.parse(compact) as string[];
        } else {
          const legacy = localStorage.getItem('arxiv_reader_library');
          if (legacy) {
            payload.library = (JSON.parse(legacy) as Array<{ id: string }>).map(x => x.id);
          }
        }
      } catch { /* ignore */ }
      // Chunk papers + scores in case the user has hundreds — keeps each
      // request under ~5MB even before the server's higher limit.
      const PAPER_CHUNK = 100;
      const SCORE_CHUNK = 500;
      const totals = { papers: 0, library: 0, readIds: 0, trackers: 0, scores: 0 };
      // Push everything else in one go (small lists), then papers/scores in chunks
      const r0 = await migrateFromIdb({
        papers:   [],
        library:  payload.library,
        readIds:  payload.readIds,
        trackers: payload.trackers,
        scores:   [],
      });
      Object.assign(totals, {
        library:  r0.counts?.library  ?? 0,
        readIds:  r0.counts?.readIds  ?? 0,
        trackers: r0.counts?.trackers ?? 0,
      });
      for (let i = 0; i < payload.papers.length; i += PAPER_CHUNK) {
        const chunk = payload.papers.slice(i, i + PAPER_CHUNK);
        const rc = await migrateFromIdb({ papers: chunk, library: [], readIds: [], trackers: [], scores: [] });
        totals.papers += rc.counts?.papers ?? 0;
      }
      for (let i = 0; i < payload.scores.length; i += SCORE_CHUNK) {
        const chunk = payload.scores.slice(i, i + SCORE_CHUNK);
        const rc = await migrateFromIdb({ papers: [], library: [], readIds: [], trackers: [], scores: chunk });
        totals.scores += rc.counts?.scores ?? 0;
      }
      const ts = new Date().toISOString();
      localStorage.setItem('arxiv_idb_migrated_at', ts);
      setMigratedAt(ts);
      setResult({ ok: true, message: `Pushed ${totals.papers} papers · ${totals.trackers} trackers · ${totals.scores} scores · ${totals.readIds} read marks · ${totals.library} library items.` });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Migration failed' });
    } finally {
      setMigrating(false);
    }
  }

  async function switchToServer() {
    if (!dbStatus?.enabled) return;
    // If they haven't migrated yet and there's local data, give them the option to push first
    const hasLocal = idbStats && (idbStats.papers > 0 || idbStats.trackers > 0 || idbStats.readIds > 0);
    if (hasLocal && !migratedAt) {
      const shouldMigrate = await confirm({
        title: 'Push local data first?',
        message: 'You have local data that isn\'t in the server yet. Recommended: push it now so the server starts with your existing inbox + library + trackers. Otherwise the server will start empty (your local data is safe — you can switch back any time).',
        confirmLabel: 'Push then switch',
        cancelLabel:  'Switch without pushing',
        tone: 'warning',
      });
      if (shouldMigrate) await handleMigrate();
    }
    setStorageMode('server');
    setMode('server');
    setResult({ ok: true, message: 'Server storage is now active. New papers from sync will go straight to Postgres.' });
  }

  function switchToIdb() {
    setStorageMode('idb');
    setMode('idb');
    setResult({ ok: true, message: 'Local storage active. Your server data stays put — switch back any time.' });
  }

  return (
    <Section
      title="Storage backend"
      description="Where Inbox, Library, Tracking & Scores live. Books, Writer, Collections, and Cross-references always use Postgres."
    >
      {/* Active mode picker */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={switchToIdb}
          className={`text-left rounded-lg border p-3 transition-all ${mode === 'idb'
            ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-100'
            : 'border-slate-200 hover:bg-slate-50'}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Database size={13} className={mode === 'idb' ? 'text-blue-600' : 'text-slate-500'} />
            <span className={`text-sm font-semibold ${mode === 'idb' ? 'text-blue-800' : 'text-slate-700'}`}>Local (IndexedDB)</span>
            {mode === 'idb' && <CheckCircle2 size={11} className="text-blue-600 ml-auto" />}
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">Works offline, no server needed.</p>
        </button>
        <button
          onClick={switchToServer}
          disabled={!dbStatus?.enabled}
          className={`text-left rounded-lg border p-3 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${mode === 'server'
            ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100'
            : 'border-slate-200 hover:bg-slate-50'}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <UploadCloud size={13} className={mode === 'server' ? 'text-emerald-600' : 'text-slate-500'} />
            <span className={`text-sm font-semibold ${mode === 'server' ? 'text-emerald-800' : 'text-slate-700'}`}>Server (Postgres)</span>
            {mode === 'server' && <CheckCircle2 size={11} className="text-emerald-600 ml-auto" />}
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {dbStatus?.enabled ? 'Cross-references reachable from anywhere.' : 'DB not running.'}
          </p>
        </button>
      </div>

      {/* Local + server counts */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-slate-500 w-16">Local:</span>
          <span className="font-mono text-slate-800">
            {idbStats
              ? `${idbStats.papers} papers · ${idbStats.trackers} trackers · ${idbStats.scores} scores · ${idbStats.readIds} read`
              : '—'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 w-16">Server:</span>
          {dbStatus?.enabled
            ? <span className="text-emerald-600 font-medium">connected</span>
            : <span className="text-amber-600 font-medium">disconnected — start the DB with <code className="px-1 py-0.5 bg-white rounded">npm run db:up</code></span>}
        </div>
        {migratedAt && (
          <div className="flex items-center gap-2 text-[11px] text-emerald-700">
            <CheckCircle2 size={11} /> last migrated {new Date(migratedAt).toLocaleString()}
          </div>
        )}
      </div>

      <button
        onClick={handleMigrate}
        disabled={migrating || !dbStatus?.enabled || !idbStats || (idbStats.papers === 0 && idbStats.trackers === 0 && idbStats.readIds === 0)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {migrating ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
        {migrating ? 'Pushing to server…' : migratedAt ? 'Push local data to server again' : 'Push local data to server now'}
      </button>

      {result && (
        <div className={`text-xs flex items-start gap-1.5 px-2 py-1.5 rounded-md ${result.ok ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
          {result.ok ? <CheckCircle2 size={12} className="mt-0.5" /> : <AlertCircle size={12} className="mt-0.5" />}
          <span>{result.message}</span>
        </div>
      )}
    </Section>
  );
}

// =========================================================================
// AI correlations background worker controls
// =========================================================================

function CorrelationsSection() {
  const c = useCorrelations();
  const nextAt = c.workerNextEligibleAt;

  return (
    <Section
      title="AI correlations cache"
      description="Pre-computes which papers in your library are related, so paper detail loads correlations instantly without burning tokens on every click. Rate-limited to 100 papers/hour."
    >
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={c.enabled}
          onChange={e => c.setEnabled(e.target.checked)}
          disabled={!c.dbEnabled}
          className="mt-0.5 w-4 h-4 accent-fuchsia-500"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Brain size={14} className={c.enabled ? 'text-fuchsia-500' : 'text-slate-400'} />
            <span className={`text-sm font-medium ${c.enabled ? 'text-fuchsia-700' : 'text-slate-700'}`}>
              Run background worker
            </span>
            {c.workerBusy && <span className="text-[10px] text-fuchsia-600 font-semibold animate-pulse">scoring…</span>}
          </div>
          <p className="text-xs text-slate-500 leading-relaxed mt-1">
            {c.dbEnabled
              ? 'When enabled, picks one un-scored paper from your inbox/library every minute and scores it against up to 18 others. Stops at 100 papers/hour.'
              : 'Requires server DB. Start it with npm run db:up.'}
          </p>
        </div>
      </label>

      {c.stats && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Total cached correlations:</span>
            <span className="font-mono text-slate-800">{c.stats.total.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Source papers scored:</span>
            <span className="font-mono text-slate-800">{c.stats.distinctSources.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Scored in last hour:</span>
            <span className="font-mono text-slate-800">
              {c.stats.papersInLastHour} / 100
              {c.stats.papersInLastHour >= 100 && <span className="text-amber-600 ml-1">(limit reached)</span>}
            </span>
          </div>
          {c.workerLastRun && (
            <p className="text-[11px] text-slate-400 pt-1.5 border-t border-slate-200">
              last run: {c.workerLastRun.toLocaleTimeString()}
              {nextAt && c.enabled && <> · next eligible: {nextAt.toLocaleTimeString()}</>}
            </p>
          )}
        </div>
      )}

      {c.workerLastError && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded">
          last error: {c.workerLastError}
        </p>
      )}
    </Section>
  );
}
