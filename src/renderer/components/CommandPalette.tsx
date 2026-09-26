import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  group: string;
  icon?: LucideIcon;
  leading?: JSX.Element;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

/** Spotlight-style command palette (⌘K). Arrow keys move, Return runs, Escape closes. */
export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items.filter((item) => item.group !== 'Processes').slice(0, 40);
    const terms = normalized.split(/\s+/);
    return items
      .map((item) => {
        const haystack = `${item.label} ${item.detail ?? ''} ${item.keywords ?? ''}`.toLowerCase();
        if (!terms.every((term) => haystack.includes(term))) return null;
        const label = item.label.toLowerCase();
        const score = label.startsWith(normalized) ? 0 : label.includes(normalized) ? 1 : 2;
        return { item, score };
      })
      .filter((entry): entry is { item: PaletteItem; score: number } => entry !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40)
      .map((entry) => entry.item);
  }, [items, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = results[active];
      if (item) {
        onClose();
        item.run();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  let lastGroup = '';
  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <label className="palette-input">
          <Search size={18} strokeWidth={1.8} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKeyDown} placeholder="Search processes, agents, and actions" spellCheck={false} />
        </label>
        <div className="palette-list" ref={listRef} role="listbox">
          {results.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <div key={item.id}>
                {header ? <div className="palette-group">{header}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  className={index === active ? 'is-active' : ''}
                  onMouseMove={() => setActive(index)}
                  onClick={() => {
                    onClose();
                    item.run();
                  }}
                >
                  {item.leading ?? (Icon ? <Icon size={15} strokeWidth={1.8} /> : null)}
                  <span className="palette-label">{item.label}</span>
                  {item.detail ? <span className="palette-detail">{item.detail}</span> : null}
                  {item.shortcut ? <kbd className="kbd">{item.shortcut}</kbd> : null}
                </button>
              </div>
            );
          })}
          {!results.length ? <div className="palette-empty">No results for “{query}”</div> : null}
        </div>
      </section>
    </div>
  );
}
