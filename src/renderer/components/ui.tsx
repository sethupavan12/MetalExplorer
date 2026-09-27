import {
  AppWindow,
  Bot,
  Cpu,
  Database,
  Globe,
  HelpCircle,
  Server,
  ShieldCheck,
  Terminal,
  Wrench,
  type LucideIcon
} from 'lucide-react';
import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react';
import type { CodingAgentKind, ProcessCategory, ProcessInfo } from '../../shared/types';
import { AGENT_COLORS, AGENT_MONOGRAMS } from '../lib/model';

export type Tone = 'neutral' | 'good' | 'warning' | 'critical' | 'info' | 'accent';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'plain';
  size?: 'small' | 'regular' | 'large';
  icon?: LucideIcon;
}

export function Button({ variant = 'secondary', size = 'regular', icon: Icon, children, className = '', type = 'button', ...rest }: ButtonProps): JSX.Element {
  return (
    <button type={type} className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {Icon ? <Icon size={size === 'small' ? 13 : 14} strokeWidth={1.9} aria-hidden /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  spinning?: boolean;
}

export function IconButton({ icon: Icon, label, active, spinning, className = '', type = 'button', ...rest }: IconButtonProps): JSX.Element {
  return (
    <button type={type} className={`icon-btn ${active ? 'is-active' : ''} ${className}`} aria-label={label} title={label} aria-pressed={active} {...rest}>
      <Icon size={16} strokeWidth={1.8} className={spinning ? 'spin' : undefined} aria-hidden />
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'regular'
}: {
  options: Array<{ id: T; label: string; icon?: LucideIcon; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'small' | 'regular';
}): JSX.Element {
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const Icon = option.icon;
        const selected = option.id === value;
        return (
          <button key={option.id} type="button" role="radio" aria-checked={selected} className={selected ? 'is-selected' : ''} onClick={() => onChange(option.id)}>
            {Icon ? <Icon size={13} strokeWidth={1.9} aria-hidden /> : null}
            <span>{option.label}</span>
            {option.count !== undefined ? <em>{option.count}</em> : null}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }): JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }): JSX.Element {
  return <span className={`status-dot tone-${tone} ${pulse ? 'pulse' : ''}`} aria-hidden />;
}

export function Pill({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }): JSX.Element {
  return (
    <span className={`pill tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function AgentMonogram({ kind, size = 28 }: { kind: CodingAgentKind; size?: number }): JSX.Element {
  return (
    <span className="agent-monogram" style={{ width: size, height: size, fontSize: Math.round(size * 0.4), ['--agent-color' as string]: AGENT_COLORS[kind] }} aria-hidden>
      {AGENT_MONOGRAMS[kind]}
    </span>
  );
}

const CATEGORY_ICONS: Record<ProcessCategory, LucideIcon> = {
  'macos-system': ShieldCheck,
  'local-server': Server,
  'ai-agent': Bot,
  'developer-tool': Wrench,
  database: Database,
  browser: Globe,
  'user-app': AppWindow,
  unknown: HelpCircle
};

export function ProcessGlyph({ process }: { process: Pick<ProcessInfo, 'category' | 'tty' | 'tags'> }): JSX.Element {
  const Icon = process.tags.includes('coding-agent') ? Terminal : process.category === 'user-app' && process.tty ? Cpu : CATEGORY_ICONS[process.category];
  return (
    <span className={`process-glyph cat-${process.category}`} aria-hidden>
      <Icon size={12} strokeWidth={2} />
    </span>
  );
}

export function Meter({ value, max = 100, tone = 'accent', label }: { value: number; max?: number; tone?: Tone; label?: string }): JSX.Element {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className={`meter tone-${tone}`} role="meter" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <span style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function Section({ title, trailing, children, className = '' }: { title: string; trailing?: ReactNode; children: ReactNode; className?: string }): JSX.Element {
  return (
    <section className={`section ${className}`}>
      <header className="section-header">
        <h3>{title}</h3>
        {trailing}
      </header>
      {children}
    </section>
  );
}

export function PropertyList({ children }: { children: ReactNode }): JSX.Element {
  return <dl className="property-list">{children}</dl>;
}

export function Property({ label, children, mono, title }: { label: string; children: ReactNode; mono?: boolean; title?: string }): JSX.Element {
  return (
    <div className="property">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined} title={title}>
        {children}
      </dd>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, detail, action }: { icon: LucideIcon; title: string; detail?: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="empty-state">
      <Icon size={28} strokeWidth={1.4} aria-hidden />
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return <kbd className="kbd">{children}</kbd>;
}
