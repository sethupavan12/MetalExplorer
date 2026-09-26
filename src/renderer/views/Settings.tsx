import { KeyRound, Lock, Monitor, Moon, Sun, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { AppSettings, SettingsUpdate, ThemeName } from '../../shared/types';
import { Button, Pill, Segmented, Switch } from '../components/ui';
import { RULE_PRESETS, type UserRules } from '../lib/model';

interface SettingsViewProps {
  settings: AppSettings;
  rules: UserRules;
  onUpdate: (update: SettingsUpdate) => Promise<void>;
  onRulesChange: (rules: UserRules) => void;
  onResetRules: () => void;
}

const THEMES: Array<{ id: ThemeName; label: string; icon: typeof Sun }> = [
  { id: 'system', label: 'Auto', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'matrix', label: 'Matrix', icon: Terminal }
];

const REFRESH_OPTIONS = [
  { id: '1000', label: '1s' },
  { id: '2000', label: '2s' },
  { id: '3000', label: '3s' },
  { id: '5000', label: '5s' },
  { id: '10000', label: '10s' }
];

export function SettingsView({ settings, rules, onUpdate, onRulesChange, onResetRules }: SettingsViewProps): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
  }, [settings.baseUrl, settings.model]);

  const refreshValue = REFRESH_OPTIONS.some((option) => Number(option.id) === settings.refreshMs) ? String(settings.refreshMs) : '3000';

  return (
    <div className="settings scroll-area">
      <div className="settings-column">
        <SettingsGroup title="Appearance">
          <SettingsRow label="Theme" detail="Auto follows your macOS appearance.">
            <div className="theme-picker" role="radiogroup" aria-label="Theme">
              {THEMES.map((theme) => {
                const Icon = theme.icon;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    role="radio"
                    aria-checked={settings.theme === theme.id}
                    className={`theme-swatch theme-swatch-${theme.id} ${settings.theme === theme.id ? 'is-selected' : ''}`}
                    onClick={() => void onUpdate({ theme: theme.id })}
                  >
                    <span className="swatch-preview">
                      <Icon size={14} />
                    </span>
                    <span>{theme.label}</span>
                  </button>
                );
              })}
            </div>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Monitoring">
          <SettingsRow label="Update frequency" detail="How often processes, network, and agents are sampled.">
            <Segmented label="Update frequency" size="small" value={refreshValue} options={REFRESH_OPTIONS} onChange={(value) => void onUpdate({ refreshMs: Number(value) })} />
          </SettingsRow>
          <SettingsRow label="Menu bar monitor" detail="Show CPU and agent status in the menu bar while MetalExplorer is open.">
            <Switch label="Menu bar monitor" checked={settings.menuBarMonitor} onChange={(value) => void onUpdate({ menuBarMonitor: value })} />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Coding agents">
          <SettingsRow
            label="Session insights"
            detail="Read token counts, model, branch, and busy/idle status that Claude Code and Codex already keep in ~/.claude and ~/.codex. Only numbers and names are read; prompts and replies are skipped, nothing is stored, and nothing leaves this Mac."
          >
            <Switch label="Session insights" checked={settings.agentUsage} onChange={(value) => void onUpdate({ agentUsage: value })} />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="AI explanations" footer="Explanations run only when you click Explain. MetalExplorer sends a redacted summary of that one process to the endpoint below.">
          <SettingsRow label="Endpoint" detail="Any OpenAI-compatible API, including local servers.">
            <input
              className="text-field"
              value={baseUrl}
              spellCheck={false}
              onChange={(event) => setBaseUrl(event.target.value)}
              onBlur={() => baseUrl !== settings.baseUrl && void onUpdate({ baseUrl })}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              aria-label="AI endpoint"
            />
          </SettingsRow>
          <SettingsRow label="Model">
            <input
              className="text-field"
              value={model}
              spellCheck={false}
              onChange={(event) => setModel(event.target.value)}
              onBlur={() => model !== settings.model && void onUpdate({ model })}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              aria-label="AI model"
            />
          </SettingsRow>
          <SettingsRow label="API key" detail={settings.hasApiKey ? 'A key is set for this session.' : 'Kept in memory unless you choose to remember it.'}>
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!apiKey.trim()) return;
                void onUpdate({ apiKey }).then(() => setApiKey(''));
              }}
            >
              <input className="text-field" type="password" value={apiKey} placeholder={settings.hasApiKey ? '••••••••' : 'sk-…'} onChange={(event) => setApiKey(event.target.value)} aria-label="API key" />
              <Button type="submit" size="small" icon={KeyRound} disabled={!apiKey.trim()}>
                Save
              </Button>
              {settings.hasApiKey ? (
                <Button size="small" variant="plain" onClick={() => void onUpdate({ clearApiKey: true })}>
                  Remove
                </Button>
              ) : null}
            </form>
          </SettingsRow>
          <SettingsRow label="Remember key" detail={settings.encryptionAvailable ? 'Encrypted with your macOS keychain-backed storage.' : 'Encrypted storage is unavailable on this Mac.'}>
            <Switch label="Remember key" checked={settings.rememberApiKey} disabled={!settings.encryptionAvailable} onChange={(value) => void onUpdate({ rememberApiKey: value })} />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Rules" footer="Rules only change how processes are flagged in this app. They never stop anything.">
          <SettingsRow label="Profile" detail={RULE_PRESETS.find((preset) => preset.id === rules.preset)?.detail}>
            <Segmented label="Rule profile" size="small" value={rules.preset} options={RULE_PRESETS.map(({ id, label }) => ({ id, label }))} onChange={(preset) => onRulesChange({ ...rules, preset })} />
          </SettingsRow>
          <SettingsRow label="Your rules" detail={`${rules.keep.length} always keep · ${rules.flag.length} always flag`}>
            <Button size="small" onClick={onResetRules} disabled={!rules.keep.length && !rules.flag.length && rules.preset === 'balanced'}>
              Reset Rules
            </Button>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Privacy">
          <div className="privacy-grid">
            <PrivacyItem label="Telemetry" value="None" />
            <PrivacyItem label="Process history" value="Memory only" />
            <PrivacyItem label="AI calls" value="On demand" />
            <PrivacyItem label="Stop signal" value="SIGTERM" />
          </div>
          <p className="settings-footnote">
            <Lock size={12} /> MetalExplorer reads process state with ps, lsof, nettop, and vm_stat. It needs no admin rights, installs no daemon, and never stops root or other users' processes.
          </p>
        </SettingsGroup>
      </div>
    </div>
  );
}

function SettingsGroup({ title, footer, children }: { title: string; footer?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="settings-group">
      <h2>{title}</h2>
      <div className="settings-card">{children}</div>
      {footer ? <p className="settings-footnote">{footer}</p> : null}
    </section>
  );
}

function SettingsRow({ label, detail, children }: { label: string; detail?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <strong>{label}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function PrivacyItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="privacy-item">
      <span>{label}</span>
      <Pill tone="good">{value}</Pill>
    </div>
  );
}
