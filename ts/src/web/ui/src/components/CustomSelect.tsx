import { useState, useRef, useEffect, useCallback } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}

export function CustomSelect({ value, options, onChange }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedLabel = options.find(o => o.value === value)?.label ?? '';

  // Close on outside mousedown
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll focused option into view
  useEffect(() => {
    if (!open || focusIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[focusIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex, open]);

  const toggle = useCallback(() => {
    setOpen(prev => {
      if (!prev) {
        // When opening, set focus to current selection
        const idx = options.findIndex(o => o.value === value);
        setFocusIndex(idx >= 0 ? idx : 0);
      }
      return !prev;
    });
  }, [options, value]);

  const select = useCallback((val: string) => {
    onChange(val);
    setOpen(false);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIndex(prev => (prev + 1) % options.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIndex(prev => (prev - 1 + options.length) % options.length);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusIndex >= 0 && focusIndex < options.length) {
          select(options[focusIndex].value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
    }
  }, [open, focusIndex, options, toggle, select]);

  return (
    <div ref={containerRef} className="relative inline-block" onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 bg-surface border border-border rounded-md px-2 py-1.5 text-xs text-text hover:border-accent transition cursor-pointer min-w-[100px]"
      >
        <span className="truncate flex-1 text-left">{selectedLabel}</span>
        <svg
          className={`w-3 h-3 flex-shrink-0 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute left-0 top-full mt-1 z-50 w-max min-w-full max-h-60 overflow-y-auto bg-surface border border-border rounded-md shadow-lg py-0.5"
        >
          {options.map((option, i) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(e) => { e.preventDefault(); select(option.value); }}
              onMouseEnter={() => setFocusIndex(i)}
              className={`px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                option.value === value
                  ? 'text-accent bg-accent/10'
                  : i === focusIndex
                    ? 'bg-surface-hover text-text'
                    : 'text-text hover:bg-surface-hover'
              }`}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
