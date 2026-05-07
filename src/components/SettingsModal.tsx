import { useState, useEffect } from 'react';
import { X, Mail, Hash, RefreshCw } from 'lucide-react';
import { usePapers } from '../contexts/PapersContext';

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const { settings, updateSettings, sync } = usePapers();
  const [senderEmail, setSenderEmail] = useState(settings.senderEmail);
  const [maxEmails, setMaxEmails] = useState(settings.maxEmails);

  useEffect(() => {
    setSenderEmail(settings.senderEmail);
    setMaxEmails(settings.maxEmails);
  }, [settings]);

  function handleSave() {
    updateSettings({ senderEmail, maxEmails });
    onClose();
    // Force re-sync with new settings
    setTimeout(() => sync(true), 100);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 mx-4 fade-in">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-800">Email Settings</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Sender email to parse
            </label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                value={senderEmail}
                onChange={e => setSenderEmail(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
                placeholder="cs@arxiv.org"
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Common arXiv senders:{' '}
              <button onClick={() => setSenderEmail('no-reply@arxiv.org')} className="text-blue-400 hover:underline">no-reply@arxiv.org</button>
              {' '}·{' '}
              <button onClick={() => setSenderEmail('cs@arxiv.org')} className="text-blue-400 hover:underline">cs@arxiv.org</button>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Max emails to fetch
            </label>
            <div className="relative">
              <Hash size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="number"
                min={5}
                max={100}
                value={maxEmails}
                onChange={e => setMaxEmails(Number(e.target.value))}
                className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Higher values fetch more history but take longer (5–100).
            </p>
          </div>
        </div>

        <div className="mt-7 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            <RefreshCw size={14} />
            Save & Sync
          </button>
        </div>
      </div>
    </div>
  );
}
