import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { classify, consoleEntityPath } from './classify';
import { rq } from './tokens';

const FIELDS = ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'metadata.labels'];
const KINDS = ['component', 'api', 'system', 'resource', 'group'];

export function findMatches(entities: Entity[], text: string, max = 8): Entity[] {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const score = (e: Entity) => {
    const n = e.metadata.name.toLowerCase();
    const title = (e.metadata.title ?? '').toLowerCase();
    if (n === t || title === t) return 0;
    if (n.startsWith(t) || title.startsWith(t)) return 1;
    return n.includes(t) || title.includes(t) ? 2 : 9;
  };
  return entities
    .map(e => [score(e), e] as const)
    .filter(([s]) => s < 9)
    .sort((a, b) => a[0] - b[0] || a[1].metadata.name.localeCompare(b[1].metadata.name))
    .slice(0, max)
    .map(([, e]) => e);
}

/** Header search: type a name, jump to its page in the console. The catalog is read once, on first focus. */
export const QuickFind = () => {
  const catalog = useApi(catalogApiRef);
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Entity[] | undefined>();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const loading = useRef(false);
  const load = useCallback(() => {
    if (entities || loading.current) return;
    loading.current = true;
    catalog.getEntities({ filter: { kind: KINDS }, fields: FIELDS }).then(
      r => setEntities(r.items),
      () => setEntities([]),
    );
  }, [catalog, entities]);
  const matches = useMemo(() => findMatches(entities ?? [], text), [entities, text]);
  const go = (e: Entity) => {
    setOpen(false);
    setText('');
    navigate(consoleEntityPath(e));
  };
  return (
    <Box sx={{ position: 'relative', minWidth: { xs: '100%', sm: 260 }, flex: { xs: '1 1 100%', sm: '0 1 320px' } }}>
      <Box
        component="input"
        type="search"
        aria-label="Find in the catalog"
        placeholder="Find an application, service, API…"
        value={text}
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'ArrowDown') setActive(a => Math.min(a + 1, matches.length - 1));
          else if (e.key === 'ArrowUp') setActive(a => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && matches[active]) go(matches[active]);
          else if (e.key === 'Escape') setOpen(false);
        }}
        sx={{
          width: '100%',
          boxSizing: 'border-box',
          bgcolor: 'rgba(255,255,255,0.12)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.3)',
          borderRadius: '8px',
          px: 1.5,
          py: 0.75,
          fontSize: 14,
          '&::placeholder': { color: 'rgba(255,255,255,0.75)' },
          '&:focus': { outline: '2px solid #FF9800', outlineOffset: 1 },
        }}
      />
      {open && text.trim() && (
        <Box
          component="ul"
          role="listbox"
          aria-label="Matches"
          sx={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 1300, m: 0, p: 0.5, listStyle: 'none', bgcolor: 'background.paper', color: 'text.primary', borderRadius: '8px', boxShadow: 6, border: 1, borderColor: 'divider' }}
        >
          {!entities && <Box component="li" sx={{ px: 1.5, py: 1, color: 'text.secondary', fontSize: 14 }}>Reading the catalog…</Box>}
          {entities && matches.length === 0 && <Box component="li" sx={{ px: 1.5, py: 1, color: 'text.secondary', fontSize: 14 }}>Nothing matches.</Box>}
          {matches.map((e, i) => {
            const k = classify(e);
            let what = e.kind;
            if (k === 'business') what = 'Business application';
            else if (k === 'service') what = 'Refresquito service';
            return (
              <Box component="li" key={stringifyEntityRef(e)} role="option" aria-selected={i === active}>
                <Box
                  component="button"
                  type="button"
                  onMouseDown={(ev: React.MouseEvent) => ev.preventDefault()}
                  onClick={() => go(e)}
                  sx={{
                    width: '100%',
                    textAlign: 'left',
                    border: 0,
                    borderRadius: '6px',
                    px: 1.5,
                    py: 1,
                    cursor: 'pointer',
                    bgcolor: i === active ? 'action.selected' : 'transparent',
                    color: 'inherit',
                    font: 'inherit',
                    display: 'grid',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{e.metadata.title ?? e.metadata.name}</span>
                  <span style={{ fontSize: 12, color: k === 'business' ? rq.biz.fg : '#5A6878' }}>
                    {what} · {e.metadata.name}
                  </span>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
};
