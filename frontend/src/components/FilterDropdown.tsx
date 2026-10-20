import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface FilterDropdownOption {
  value: string;
  label: string;
  hint?: string;
  badge?: string;
}

interface FilterDropdownProps {
  id: string;
  label: string;
  value: string;
  options: FilterDropdownOption[];
  onChange: (value: string) => void;
  className?: string;
}

export default function FilterDropdown({ id, label, value, options, onChange, className }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const typeahead = useRef({ query: '', time: 0 });
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const selectedOption = options[selectedIndex];
  const menuId = `${id}-menu`;

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  const openMenu = () => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const moveTo = (index: number) => {
    setActiveIndex((index + options.length) % options.length);
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveTo(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeMenu(true);
    } else if (event.key.length === 1 && event.key.trim()) {
      const now = Date.now();
      const previous = now - typeahead.current.time < 700 ? typeahead.current.query : '';
      const query = previous.length === 1 && previous.toLocaleLowerCase('fr-FR') === event.key.toLocaleLowerCase('fr-FR')
        ? event.key
        : previous + event.key;
      typeahead.current = { query, time: now };
      const start = index + 1;
      const matchOffset = Array.from({ length: options.length }, (_, offset) => offset)
        .find(offset => options[(start + offset) % options.length].label.toLocaleLowerCase('fr-FR').startsWith(query.toLocaleLowerCase('fr-FR')));
      if (matchOffset !== undefined) {
        event.preventDefault();
        moveTo(start + matchOffset);
      }
    }
  };

  return (
    <div className={`senator-filter-field${className ? ` ${className}` : ''}`}>
      <label className="senator-filter-field-label" id={`${id}-label`} htmlFor={`${id}-trigger`}>{label}</label>
      <div className={`filter-dropdown${open ? ' is-open' : ''}`} ref={rootRef}>
        <button
          ref={triggerRef}
          className="filter-select-trigger"
          id={`${id}-trigger`}
          type="button"
          aria-labelledby={`${id}-label ${id}-value`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => open ? closeMenu() : openMenu()}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              openMenu();
            }
          }}
        >
          <span className="filter-select-value" id={`${id}-value`}>
            {selectedOption?.badge && <span className="filter-select-badge">{selectedOption.badge}</span>}
            <span className="filter-select-label">{selectedOption?.label}</span>
          </span>
          <svg className="filter-select-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="filter-select-menu" id={menuId} role="menu" aria-labelledby={`${id}-label`} hidden={!open}>
          <div className="filter-select-menu-heading" aria-hidden="true">
            <span>{label}</span>
            <span>{options.length} choix</span>
          </div>
          <div className="filter-select-options" role="group" aria-label={`Choix ${label.toLocaleLowerCase('fr-FR')}`}>
            {options.map((option, index) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  ref={element => { optionRefs.current[index] = element; }}
                  className={`filter-select-option${selected ? ' is-selected' : ''}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  tabIndex={-1}
                  onFocus={() => setActiveIndex(index)}
                  onKeyDown={event => handleOptionKeyDown(event, index)}
                  onClick={() => {
                    onChange(option.value);
                    closeMenu(true);
                  }}
                >
                  {option.badge && <span className="filter-select-option-badge">{option.badge}</span>}
                  <span className="filter-select-option-copy">
                    <span className="filter-select-option-label">{option.label}</span>
                    {option.hint && <span className="filter-select-option-hint">{option.hint}</span>}
                  </span>
                  <span className="filter-select-option-check" aria-hidden="true">
                    {selected && <svg viewBox="0 0 20 20" fill="none"><path d="m4.5 10 3.5 3.5 7.5-7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
