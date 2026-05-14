import { useState, useEffect } from 'react';
import { X, Mail, Hash, RefreshCw, Key, Eye, EyeOff } from 'lucide-react';
import { usePapers } from '../contexts/PapersContext';

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const { settings, updateSettings, sync } = usePapers();
  const [senderEmail, setSenderEmail] = useState(settings.senderEmail);
  const [maxEmails,   setMaxEmails]   = useState(settings.maxEmails);
  const [apiKey,      setApiKey]      = useState(settings.claudeApiKey ?? '');
  const [s2Key,       setS2Key]       = useState(settings.s2ApiKey ?? '');
  const [showKey,     setShowKey]     = useState(false);
  const [showS2,      setShowS2]      = useState(false);

  useEffect(() => {
    setSenderEmail(settings.senderEmail);
    setMaxEmails(settings.maxEmails);
    setApiKey(settings.claudeApiKey ?? '');
    setS2Key(settings.s2ApiKey ?? '');
  }, [settings]);

  function handleSave() {
    updateSettings({
      senderEmail,
      maxEmails,
      claudeApiKey: apiKey.trim() || undefined,
      s2ApiKey:     s2Key.trim()  || undefined,
    });
    onClose();
    setTimeout(() => sync(true), 100);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 mx-4 fade-in">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-800">Settings</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          {/* Sender email */}
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

          {/* Max emails */}
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

          {/* Claude API key */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Key size={13} className="text-violet-500" />
              Claude API Key <span className="text-xs text-slate-400 font-normal">(optional, for AI Suggestions)</span>
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-ant-…"
                className="w-full pl-3 pr-10 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
              Stored locally only. Used to call Anthropic's API directly from your browser for the ✨ AI Suggest feature.
              Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">console.anthropic.com</a>.
            </p>
          </div>

          {/* Semantic Scholar API key */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Key size={13} className="text-emerald-500" />
              Semantic Scholar API Key <span className="text-xs text-slate-400 font-normal">(optional, raises rate limits)</span>
            </label>
            <div className="relative">
              <input
                type={showS2 ? 'text' : 'password'}
                value={s2Key}
                onChange={e => setS2Key(e.target.value)}
                placeholder="(leave blank to use the free tier)"
                className="w-full pl-3 pr-10 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowS2(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showS2 ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
              Used for paper search, references, citations & similar-work discovery.
              Free tier works but gets throttled — get a personal key at <a href="https://www.semanticscholar.org/product/api#api-key-form" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">semanticscholar.org/product/api</a>.
            </p>
          </div>
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
