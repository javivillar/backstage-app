import { Progress, WarningPanel } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';

type NavItem = { title: string; path: string; depth: number };
type Page = { html: string; title: string; toc: Array<{ id: string; title: string; level: number }>; nav: NavItem[] };

/** Removes what must not run inside the console: scripts, frames, forms, inline handlers and javascript: links. */
export function cleanDoc(root: Element): void {
  root.querySelectorAll('script, iframe, object, embed, form, style, link, meta').forEach(n => n.remove());
  root.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) {
      const v = a.value.trim().toLowerCase();
      if (a.name.startsWith('on') || ((a.name === 'href' || a.name === 'src') && /^\s*(java|vb)script\s*:/.test(v))) el.removeAttribute(a.name);
    }
  });
}

/** One page of an MkDocs site (what TechDocs publishes): its article, title, headings and the site navigation. */
export function parseDocPage(html: string, base: string, path: string): Page {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const article = doc.querySelector('article') ?? doc.querySelector('.md-content') ?? doc.body;
  cleanDoc(article);
  const here = new URL(path || './', `${base}/`);
  // images and links relative to the page: absolute to the static docs (links to other pages are handled on click)
  article.querySelectorAll('img[src]').forEach(img => img.setAttribute('src', new URL(img.getAttribute('src')!, here).toString()));
  article.querySelectorAll('a.headerlink').forEach(a => a.remove());
  const toc = [...article.querySelectorAll('h2[id], h3[id]')].map(h => ({ id: h.id, title: h.textContent?.trim() ?? '', level: h.tagName === 'H2' ? 2 : 3 }));
  const nav: NavItem[] = [];
  doc.querySelectorAll('nav.md-nav--primary a.md-nav__link[href]').forEach(a => {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#') || /^[a-z]+:/.test(href)) return;
    const target = new URL(href, here).toString().slice(base.length + 1).replace(/index\.html$/, '');
    const depth = Math.max(0, a.closest('ul')?.closest('li')?.closest('ul') ? 1 : 0);
    if (!nav.some(n => n.path === target)) nav.push({ title: a.textContent?.trim() ?? target, path: target, depth });
  });
  const title = article.querySelector('h1')?.textContent?.trim() ?? doc.title;
  return { html: article.innerHTML, title, toc, nav };
}

/** The entity page › Docs, inside the console: the TechDocs site of the entity with its pages, contents and search. */
export const EntityDocsContent = () => {
  const { entity } = useEntity();
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const ref = `${entity.metadata.namespace ?? 'default'}/${entity.kind.toLowerCase()}/${entity.metadata.name}`;
  const [path, setPath] = useState('');
  const [state, setState] = useState<{ loading: boolean; page?: Page; error?: string; base?: string }>({ loading: true });
  const [q, setQ] = useState('');
  const load = useCallback(
    async (p: string) => {
      const api = await discovery.getBaseUrl('techdocs');
      const base = `${api}/static/docs/${ref}`;
      const get = () => fetch(`${base}/${p}${p === '' || p.endsWith('/') ? 'index.html' : ''}`);
      let r = await get();
      if (r.status === 404) {
        // not built yet: ask TechDocs to build it (it answers when done), then read again
        await fetch(`${api}/sync/${ref}`).then(x => x.text()).catch(() => '');
        r = await get();
      }
      if (!r.ok) throw new Error(r.status === 404 ? 'This entity has no docs (backstage.io/techdocs-ref) or they could not be built.' : `TechDocs answered ${r.status}`);
      return { page: parseDocPage(await r.text(), base, p), base };
    },
    [discovery, fetch, ref],
  );
  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true }));
    load(path).then(
      ({ page, base }) => alive && setState({ loading: false, page, base }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [load, path]);
  const nav = useMemo(() => (state.page?.nav ?? []).filter(n => !q || n.title.toLowerCase().includes(q.toLowerCase())), [state.page, q]);
  const onClick = (ev: React.MouseEvent) => {
    const a = (ev.target as HTMLElement).closest('a');
    if (!a || !state.base) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#') || /^[a-z]+:/.test(href)) {
      if (/^https?:/.test(href)) a.setAttribute('target', '_blank');
      return;
    }
    ev.preventDefault();
    const target = new URL(href, new URL(path || './', `${state.base}/`)).toString().slice(state.base.length + 1).replace(/index\.html$/, '');
    setPath(target.split('#')[0]);
  };
  const source = entity.metadata.annotations?.['backstage.io/techdocs-ref']?.replace(/^url:|^dir:/, '');
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: '230px minmax(0, 1fr) 200px' }, alignItems: 'start' }}>
      <Box component="nav" aria-label="Pages" sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 1.25, bgcolor: 'background.paper', display: 'grid', gap: 0.25, position: { lg: 'sticky' }, top: 12 }}>
        <TextField size="small" placeholder="Find a page" value={q} onChange={e => setQ(e.target.value)} inputProps={{ 'aria-label': 'Find a page' }} sx={{ mb: 0.5 }} />
        {nav.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
            One page.
          </Typography>
        )}
        {nav.map(n => (
          <Box
            key={n.path}
            component="button"
            type="button"
            onClick={() => setPath(n.path)}
            sx={{ textAlign: 'left', border: 0, cursor: 'pointer', font: 'inherit', fontSize: 14, py: 0.5, px: 1, pl: 1 + n.depth * 1.5, borderRadius: '6px', bgcolor: n.path === path ? 'rgba(26,141,255,0.10)' : 'transparent', color: n.path === path ? 'primary.main' : 'text.primary', fontWeight: n.path === path ? 600 : 400 }}
          >
            {n.title}
          </Box>
        ))}
      </Box>
      <Box component="article" sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', px: { xs: 2, md: 3.5 }, py: 2.5, bgcolor: 'background.paper', minWidth: 0 }}>
        {state.loading && <Progress />}
        {state.error && <WarningPanel severity="info" title="No docs" message={state.error} />}
        {state.page && (
          <>
            <Typography variant="caption" color="text.secondary">
              {source ? `Source: ${source}` : 'TechDocs'}
            </Typography>
            <Box
              onClick={onClick}
              sx={{
                maxWidth: '78ch',
                fontSize: 15,
                lineHeight: 1.65,
                '& h1': { fontSize: 28, fontWeight: 600, mt: 0.5, mb: 1 },
                '& h2': { fontSize: 20, fontWeight: 600, mt: 3, mb: 1 },
                '& h3': { fontSize: 16.5, fontWeight: 600, mt: 2.5, mb: 0.75 },
                '& code': { fontFamily: 'monospace', fontSize: 13, bgcolor: 'action.hover', px: 0.5, borderRadius: '4px' },
                '& pre': { bgcolor: 'action.hover', p: 1.5, borderRadius: '8px', overflowX: 'auto' },
                '& pre code': { bgcolor: 'transparent', p: 0 },
                '& table': { borderCollapse: 'collapse', display: 'block', overflowX: 'auto' },
                '& th, & td': { border: 1, borderColor: 'divider', px: 1, py: 0.5, textAlign: 'left' },
                '& img': { maxWidth: '100%' },
                '& a': { color: 'primary.main' },
                '& .admonition': { borderLeft: 3, borderColor: 'primary.main', bgcolor: 'action.hover', px: 1.5, py: 1, borderRadius: '0 8px 8px 0', my: 1.5 },
              }}
              // the HTML is the TechDocs build of the entity's own repository, cleaned by cleanDoc
              dangerouslySetInnerHTML={{ __html: state.page.html }}
            />
          </>
        )}
      </Box>
      <Box component="aside" aria-label="On this page" sx={{ display: { xs: 'none', lg: 'grid' }, gap: 0.5, position: 'sticky', top: 12, fontSize: 13.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }} color="text.secondary">
          On this page
        </Typography>
        {(state.page?.toc ?? []).map(t => (
          <Box key={t.id} component="a" href={`#${t.id}`} onClick={(e: React.MouseEvent) => { e.preventDefault(); document.getElementById(t.id)?.scrollIntoView?.({ behavior: 'smooth' }); }} sx={{ color: 'text.secondary', textDecoration: 'none', pl: t.level === 3 ? 1.5 : 0, '&:hover': { color: 'primary.main' } }}>
            {t.title}
          </Box>
        ))}
      </Box>
    </Box>
  );
};
