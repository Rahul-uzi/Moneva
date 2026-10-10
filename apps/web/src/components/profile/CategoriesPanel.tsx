import React, { useMemo, useState } from 'react';
import { Check, Pencil, Search, Trash2, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { apiClient, describeApiError } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { categoryIcon } from '../../utils/categoryIcons';
import type { Category } from '../../types/api';

type Kind = 'expense' | 'income';
type Sort = 'custom' | 'az' | 'newest';

interface CategoriesPanelProps {
  categories: Category[];
  isLoading: boolean;
  reload: () => Promise<void>;
}

/**
 * Spending and income categories, one tab each.
 *
 * Two sets, not one list: the add sheet only ever offers the categories that
 * match the kind of money being recorded, so mixing them here would show
 * look-alike rows that never appear together anywhere else.
 */
export const CategoriesPanel: React.FC<CategoriesPanelProps> = ({ categories, isLoading, reload }) => {
  const { addToast } = useUiStore();
  const [kind, setKind] = useState<Kind>('expense');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('custom');
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = categories.filter((c) => c.type === kind && (!q || c.name.toLowerCase().includes(q)));
    // 'custom' keeps the API's order: insertion order, which holds the seeded
    // defaults in their curated sequence.
    if (sort === 'az') return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'newest') return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return list;
  }, [categories, kind, query, sort]);

  const run = async (work: () => Promise<unknown>, fail: string, ok?: string) => {
    setBusy(true);
    try {
      await work();
      await reload();
      if (ok) addToast(ok, 'success');
      return true;
    } catch (err) {
      addToast(describeApiError(err, fail), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (await run(() => apiClient.post('/categories', { name, type: kind }), 'Could not add that category.', `${name} added.`)) {
      setNewName('');
      setQuery('');
    }
  };

  const rename = async (c: Category) => {
    const name = editingName.trim();
    if (!name || name === c.name) { setEditingId(null); return; }
    if (await run(() => apiClient.patch(`/categories/${c.id}`, { name }), 'Could not rename that category.', `Renamed to ${name}.`)) {
      setEditingId(null);
    }
  };

  const remove = async (c: Category) => {
    // Transactions keep their history; the API clears their category link.
    if (await run(() => apiClient.delete(`/categories/${c.id}`), 'Could not delete that category.')) {
      setConfirmDelete(null);
      addToast(`Deleted "${c.name}". Past transactions kept, now uncategorised.`, 'info');
    }
  };

  const label = kind === 'expense' ? 'spending' : 'income';

  return (
    <>
      <div className="pf-tabs" role="tablist" aria-label="Category type" style={{ '--i': kind === 'expense' ? 0 : 1 } as React.CSSProperties}>
        <span className="pf-tabs-thumb" aria-hidden="true" />
        {(['expense', 'income'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => { setKind(k); setEditingId(null); setConfirmDelete(null); }}
          >
            {k === 'expense' ? 'Spending' : 'Income'}
            <span className="pf-tabs-count">{categories.filter((c) => c.type === k).length}</span>
          </button>
        ))}
      </div>

      <div className="pf-tools">
        <label className="pf-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            className="pf-input"
            placeholder="Search categories"
            aria-label="Search categories"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select className="pf-input pf-select" aria-label="Sort categories" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="custom">Default</option>
          <option value="az">A – Z</option>
          <option value="newest">Newest</option>
        </select>
      </div>

      <div className="pf-cats">
        {isLoading && categories.length === 0 ? (
          <p className="pf-empty">Loading categories…</p>
        ) : rows.length === 0 ? (
          <p className="pf-empty">{query ? `No ${label} category called “${query}”.` : `No ${label} categories yet. Add one below.`}</p>
        ) : rows.map((c) => {
          if (confirmDelete?.id === c.id) {
            return (
              <div key={c.id} className="pf-confirm">
                <p><strong>Delete {c.name}?</strong> Transactions already filed under it are kept, but they become uncategorised.</p>
                <div className="pf-two">
                  <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Keep</Button>
                  <Button variant="danger" isLoading={busy} onClick={() => void remove(c)}>Delete</Button>
                </div>
              </div>
            );
          }
          if (editingId === c.id) {
            return (
              <form key={c.id} className="pf-cat" onSubmit={(e) => { e.preventDefault(); void rename(c); }}>
                <input
                  className="pf-input"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  aria-label={`New name for ${c.name}`}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditingId(null); } }}
                />
                <button type="submit" className="pf-icon-btn is-ok" aria-label="Save name" disabled={busy}><Check size={16} /></button>
                <button type="button" className="pf-icon-btn" aria-label="Cancel rename" onClick={() => setEditingId(null)}><X size={16} /></button>
              </form>
            );
          }
          const Icon = categoryIcon(c.icon);
          return (
            <div key={c.id} className="pf-cat">
              <span
                className="pf-cat-dot"
                style={c.color ? { color: c.color, backgroundColor: `${c.color}22` } : undefined}
                aria-hidden="true"
              >
                <Icon size={15} />
              </span>
              <span className="pf-cat-name">{c.name}</span>
              <button type="button" className="pf-icon-btn" aria-label={`Rename ${c.name}`} onClick={() => { setEditingId(c.id); setEditingName(c.name); setConfirmDelete(null); }}>
                <Pencil size={16} />
              </button>
              <button type="button" className="pf-icon-btn is-del" aria-label={`Delete ${c.name}`} onClick={() => { setConfirmDelete(c); setEditingId(null); }}>
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </div>

      <form className="pf-field" onSubmit={(e) => void add(e)}>
        <label htmlFor="pf-new-cat">New {label} category</label>
        <div className="pf-add">
          <input id="pf-new-cat" className="pf-input" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!newName.trim()} isLoading={busy && !!newName.trim()}>Add</Button>
        </div>
      </form>
    </>
  );
};
