import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, ReactNode } from 'react';
import type { SortKey, SortState } from '../lib/model';

export interface Column<T> {
  id: string;
  title: string;
  /** CSS grid track size, for example `minmax(220px, 2fr)` or `84px`. */
  width: string;
  align?: 'left' | 'right' | 'center';
  sortKey?: SortKey;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Array<Column<T>>;
  getKey: (row: T) => number | string;
  selectedKey: number | string | null;
  onSelect: (key: number | string, row: T) => void;
  onActivate?: (row: T) => void;
  sort?: SortState;
  onSort?: (key: SortKey) => void;
  rowHeight?: number;
  empty?: ReactNode;
  rowClassName?: (row: T) => string;
  label: string;
}

const OVERSCAN = 10;

/**
 * Virtualized, keyboard-navigable table. Only visible rows render, so a full process list stays cheap to update every sample.
 */
export function DataTable<T>({
  rows,
  columns,
  getKey,
  selectedKey,
  onSelect,
  onActivate,
  sort,
  onSort,
  rowHeight = 28,
  empty,
  rowClassName,
  label
}: DataTableProps<T>): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const template = columns.map((column) => column.width).join(' ');
  const minWidth = columns.reduce((total, column) => total + minimumTrackWidth(column.width), 0);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    setViewport(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const selectedIndex = selectedKey === null ? -1 : rows.findIndex((row) => getKey(row) === selectedKey);

  const ensureVisible = useCallback(
    (index: number) => {
      const element = scrollRef.current;
      if (!element || index < 0) return;
      const header = rowHeight;
      const top = index * rowHeight;
      if (top < element.scrollTop) {
        element.scrollTop = top;
      } else if (top + rowHeight > element.scrollTop + element.clientHeight - header) {
        element.scrollTop = top + rowHeight - element.clientHeight + header;
      }
    },
    [rowHeight]
  );

  // Reveal the selection when it changes (for example from the command palette), but not when a new sample merely
  // re-sorts rows; otherwise the table would jump back while the user scrolls.
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  useEffect(() => {
    ensureVisible(selectedIndexRef.current);
  }, [ensureVisible, selectedKey]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!rows.length) return;
    const pageSize = Math.max(1, Math.floor(viewport / rowHeight) - 1);
    let next = selectedIndex;
    if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, selectedIndex + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, selectedIndex - 1);
    else if (event.key === 'PageDown') next = Math.min(rows.length - 1, selectedIndex + pageSize);
    else if (event.key === 'PageUp') next = Math.max(0, selectedIndex - pageSize);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'Enter' && onActivate && selectedIndex >= 0) {
      onActivate(rows[selectedIndex]);
      return;
    } else return;

    event.preventDefault();
    if (next !== selectedIndex && rows[next]) {
      onSelect(getKey(rows[next]), rows[next]);
      ensureVisible(next);
    }
  }

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN);
  const visible = rows.slice(start, end);

  return (
    <div
      className="data-table"
      ref={scrollRef}
      tabIndex={0}
      role="grid"
      aria-label={label}
      aria-rowcount={rows.length}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={handleKeyDown}
    >
      <div className="dt-header" role="row" style={{ gridTemplateColumns: template, height: rowHeight, minWidth }}>
        {columns.map((column) => {
          const active = sort && column.sortKey && sort.key === column.sortKey;
          const content = (
            <>
              <span>{column.title}</span>
              {active ? sort?.direction === 'asc' ? <ChevronUp size={12} strokeWidth={2.2} /> : <ChevronDown size={12} strokeWidth={2.2} /> : null}
            </>
          );
          return (
            <div key={column.id} role="columnheader" className={`dt-cell align-${column.align ?? 'left'} ${active ? 'is-sorted' : ''}`} aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
              {column.sortKey && onSort ? (
                <button type="button" onClick={() => column.sortKey && onSort(column.sortKey)}>
                  {content}
                </button>
              ) : (
                content
              )}
            </div>
          );
        })}
      </div>

      {rows.length ? (
        <div className="dt-body" style={{ height: rows.length * rowHeight, minWidth }}>
          {visible.map((row, offset) => {
            const index = start + offset;
            const key = getKey(row);
            const selected = key === selectedKey;
            return (
              <div
                key={key}
                role="row"
                aria-selected={selected}
                className={`dt-row ${selected ? 'is-selected' : ''} ${index % 2 ? 'is-odd' : ''} ${rowClassName?.(row) ?? ''}`}
                style={{ gridTemplateColumns: template, height: rowHeight, transform: `translateY(${index * rowHeight}px)` }}
                onMouseDown={() => onSelect(key, row)}
                onDoubleClick={() => onActivate?.(row)}
              >
                {columns.map((column) => (
                  <div key={column.id} role="gridcell" className={`dt-cell align-${column.align ?? 'left'} ${column.className ?? ''}`}>
                    {column.render(row)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="dt-empty">{empty}</div>
      )}
    </div>
  );
}

/** Smallest width a grid track can shrink to, so narrow windows scroll horizontally instead of clipping. */
function minimumTrackWidth(track: string): number {
  const minmax = track.match(/^minmax\((\d+)px/);
  if (minmax) return Number(minmax[1]);
  const fixed = track.match(/^(\d+)px$/);
  return fixed ? Number(fixed[1]) : 60;
}
