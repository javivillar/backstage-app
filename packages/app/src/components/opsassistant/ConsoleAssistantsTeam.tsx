import { Link, Progress } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Fragment, useEffect, useState } from 'react';
import { CONSOLE_ASSISTANTS, type ConsoleAssistantDef } from './consoleAssistants';

type Summary = { id: string; title: string; updatedAt: string };
type Status = { enabled?: boolean; allowed?: boolean; model?: string; conversations: Summary[]; error?: string };

/** /info and /conversations of every assistant (one engine, one path each). */
export function useAssistantsStatus() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<Record<string, Status> | undefined>();
  useEffect(() => {
    let alive = true;
    (async () => {
      const base = await discovery.getBaseUrl('ops-assistant');
      const out: Record<string, Status> = {};
      await Promise.all(
        CONSOLE_ASSISTANTS.map(async a => {
          try {
            const info = await (await fetch(`${base}${a.profile.path}/info`)).json();
            let conversations: Summary[] = [];
            if (info.enabled && info.allowed) {
              const r = await fetch(`${base}${a.profile.path}/conversations`);
              if (r.ok) conversations = (await r.json()) as Summary[];
            }
            out[a.id] = { enabled: info.enabled, allowed: info.allowed, model: info.model, conversations };
          } catch (e) {
            out[a.id] = { conversations: [], error: (e as Error).message };
          }
        }),
      );
      return out;
    })().then(s => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [discovery, fetch]);
  return state;
}

const stateOf = (s?: Status): [string, string] => {
  if (!s) return ['…', '#5A6878'];
  if (s.error || !s.enabled) return ['Not configured', '#5A6878'];
  if (!s.allowed) return ['No access', '#8A4300'];
  return [s.conversations.length ? `${s.conversations.length} conversations` : 'Ready', '#1E6B34'];
};

/** Portal › Assistants › The team: the five assistants as one delivery chain, each with its role. */
export const ConsoleAssistantsTeam = () => {
  const catalog = useApi(catalogApiRef);
  const status = useAssistantsStatus();
  const [systems, setSystems] = useState<string[]>([]);
  const [system, setSystem] = useState('');
  useEffect(() => {
    catalog.getEntities({ filter: { kind: 'system' }, fields: ['metadata.name'] }).then(
      r => setSystems(r.items.map(e => e.metadata.name).sort()),
      () => setSystems([]),
    );
  }, [catalog]);
  const href = (a: ConsoleAssistantDef, ask?: string) => {
    const q = new URLSearchParams();
    if (system) q.set('system', system);
    if (ask) q.set('ask', ask);
    const s = q.toString();
    return `/console/${a.id}${s ? `?${s}` : ''}`;
  };
  return (
    <Box sx={{ display: 'grid', gap: 2.5, maxWidth: 1360 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
            Assistants
          </Typography>
          <Typography color="text.secondary">Five assistants, one hand-over: each starts from the last artefact a person approved in git.</Typography>
        </Box>
        <TextField select size="small" label="About the system" value={system} onChange={e => setSystem(e.target.value)} sx={{ minWidth: 240 }}>
          <MenuItem value="">Any system</MenuItem>
          {systems.map(s => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Box
        component="section"
        aria-label="Delivery chain"
        sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: '16px', p: 2.5, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(180px, 1fr))', overflowX: 'auto' }}
      >
        {CONSOLE_ASSISTANTS.map((a, i) => {
          const s = status?.[a.id];
          const [label, colour] = stateOf(s);
          const last = s?.conversations[0];
          return (
            <Fragment key={a.id}>
              <Box sx={{ position: 'relative', display: 'grid', gap: 1, justifyItems: 'center', textAlign: 'center', px: 1 }}>
                {i < CONSOLE_ASSISTANTS.length - 1 && <Box aria-hidden sx={{ position: 'absolute', top: 34, left: 'calc(50% + 40px)', right: 'calc(-50% + 40px)', height: 3, borderRadius: 2, bgcolor: 'divider' }} />}
                <Box component={Link} to={href(a)} sx={{ width: 68, height: 68, borderRadius: '20px', display: 'grid', placeItems: 'center', color: '#fff', bgcolor: a.colour, boxShadow: '0 6px 16px rgba(0,0,0,.12)' }}>
                  <a.Icon sx={{ fontSize: 34 }} />
                </Box>
                <Typography sx={{ fontWeight: 600 }}>{a.name}</Typography>
                <Box component="span" sx={{ fontSize: 12, fontWeight: 500, px: 1, py: 0.2, borderRadius: 999, bgcolor: 'action.hover', color: colour }}>
                  {label}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ maxWidth: '24ch' }}>
                  {last ? `Last: ${last.title}` : a.profile.role?.does}
                </Typography>
              </Box>
            </Fragment>
          );
        })}
      </Box>
      {!status && <Progress />}
      <Box sx={{ display: 'grid', gap: 1.75, gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))' }}>
        {CONSOLE_ASSISTANTS.map(a => {
          const r = a.profile.role;
          return (
            <Box key={a.id} component="article" sx={{ position: 'relative', overflow: 'hidden', bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: '14px', p: 1.75, display: 'grid', gap: 1.25, alignContent: 'start' }}>
              <Box aria-hidden sx={{ position: 'absolute', inset: '0 0 auto', height: 4, bgcolor: a.colour }} />
              <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center' }}>
                <Box sx={{ width: 40, height: 40, borderRadius: '12px', display: 'grid', placeItems: 'center', color: '#fff', bgcolor: a.colour, flexShrink: 0 }}>
                  <a.Icon />
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>{a.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {r?.does ?? a.profile.subtitle}
                  </Typography>
                </Box>
              </Box>
              {r && (
                <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '3px 12px', m: 0, fontSize: 13.5 }}>
                  {(
                    [
                      ['Reads', r.reads],
                      ['Writes', r.writes],
                      ['Never', r.never],
                    ] as const
                  ).map(([k, v]) => (
                    <Fragment key={k}>
                      <Box component="dt" sx={{ color: 'text.secondary' }}>
                        {k}
                      </Box>
                      <Box component="dd" sx={{ m: 0 }}>
                        {v}
                      </Box>
                    </Fragment>
                  ))}
                </Box>
              )}
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {a.profile.examples.slice(0, 2).map(q => (
                  <Box key={q} component={Link} to={href(a, q)} sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 999, px: 1.25, py: 0.4, fontSize: 13, color: 'text.primary', textDecoration: 'none', '&:hover': { borderColor: a.colour } }}>
                    {q}
                  </Box>
                ))}
              </Box>
              <Box component={Link} to={href(a)} sx={{ fontWeight: 600 }}>
                Open {a.name.toLowerCase()} →
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
