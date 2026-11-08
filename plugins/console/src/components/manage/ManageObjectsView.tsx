import { Progress, WarningPanel } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  type DeclaredObject,
  type ManageOwner,
  ownerKey,
  type OwnerView,
  pendingFor,
  useManageDeclared,
  useManageOwners,
  useManagePending,
} from '../../manage';
import { Badge } from '../Badge';
import { TONES } from '../Flow';
import { type HostOf, type Row, useHostOf, useManagerList } from '../ManagePages';
import { rq } from '../tokens';
import { DeleteConfirm } from './DeleteConfirm';
import { ManageForm } from './ManageForm';
import type { Field } from './manageFormModel';

/**
 * One kind of object of a Manage page, in the console: what the product has now (its manager backend), joined to what
 * git declares of it (GET /api/manage/declared), with create, change and remove by pull request (ManageForm,
 * DeleteConfirm). An object made outside git is shown, marked, and cannot be changed here until it is declared.
 */
export type Column = { key: string; label: string; render?: (r: Row) => ReactNode };
export type Kind = {
  /** the tab */
  label: string;
  /** service and object of /api/manage */
  service: string;
  object: string;
  /** singular, for the titles: "group" */
  what: string;
  /** the live objects (a manager backend: { items }); none: only what git declares is listed */
  live?: { plugin: string; path: string };
  columns: Column[];
  /** the id and owner of a live object in git, as its marker says; undefined when it was made outside git */
  key?: (r: Row) => { owner: ManageOwner; id: string } | undefined;
  /** a declared object not live yet, as a row of the table */
  rowOf?: (d: DeclaredObject) => Row;
  title: (r: Row) => string;
  facts?: (r: Row) => Array<[string, ReactNode]>;
  /** where it is seen in the product (a new tab) */
  open?: (r: Row, host: HostOf) => string | undefined;
  /** the fields of the form for an object of an application, and for one of the platform; none: it cannot be */
  appFields?: Field[];
  platformFields?: Field[];
  /** the values of the edit form from what git declares */
  values?: (d: DeclaredObject) => Record<string, unknown>;
  /** create is not offered (e.g. users, or objects that come from an ingestion) */
  noCreate?: boolean;
  /** an application has exactly one already (its sign-in client): only change and remove */
  noCreateApp?: boolean;
  /** the id of a new object is the application it belongs to (one per application: a block of its file) */
  idFromOwner?: boolean;
  /** read only: nothing of git is joined (no object of /api/manage) */
  readOnly?: boolean;
  noEdit?: boolean;
  /** a note above the table */
  note?: ReactNode;
};

type Mode = { kind: 'create'; platform: boolean } | { kind: 'edit'; d: DeclaredObject } | { kind: 'delete'; d: DeclaredObject } | undefined;

const ownerLabel = (o: ManageOwner, owners: OwnerView[] | undefined, es: boolean) =>
  o.kind === 'platform' ? (es ? 'plataforma' : 'platform') : owners?.find(x => x.kind === 'application' && x.name === o.name)?.title ?? o.name;

export const ManageObjectsView = ({ kind }: { kind: Kind }) => {
  const { lang } = useI18n();
  const es = lang === 'es';
  const tx = (en: string, sp: string) => (es ? sp : en);
  const host = useHostOf();
  const live = useManagerList(kind.live?.plugin, kind.live?.path);
  const declared = useManageDeclared(kind.service, kind.object);
  const owners = useManageOwners();
  const pending = useManagePending(kind.service);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<Mode>();

  // live objects with what git says of each, then the declared ones that are not live yet (a pull request merged and
  // not applied, or an object of another cluster)
  const rows = useMemo(() => {
    const decl = new Map((kind.readOnly ? [] : declared.data ?? []).map(d => [`${ownerKey(d.owner)}|${d.id}`, d]));
    const seen = new Set<string>();
    const out: Array<{ r: Row; d?: DeclaredObject; liveRow: boolean }> = [];
    for (const r of live.items ?? []) {
      const k = kind.key?.(r);
      const id = k ? `${ownerKey(k.owner)}|${k.id}` : undefined;
      const d = id ? decl.get(id) : undefined;
      if (id) seen.add(id);
      out.push({ r, d, liveRow: true });
    }
    for (const [id, d] of decl) {
      if (seen.has(id) || !kind.rowOf) continue;
      out.push({ r: kind.rowOf(d), d, liveRow: !kind.live });
    }
    return out.filter(x => !q || JSON.stringify(x.r).toLowerCase().includes(q.toLowerCase()));
  }, [live.items, declared.data, kind, q]);
  const picked = rows[Math.min(sel, rows.length - 1)];
  const writable = (o: ManageOwner) => !!owners.data?.find(x => ownerKey(x.kind === 'platform' ? { kind: 'platform' } : { kind: 'application', name: x.name }) === ownerKey(o))?.canWrite;
  const canCreateApp = !kind.readOnly && !kind.noCreate && !kind.noCreateApp && !!kind.appFields && !!owners.data?.some(o => o.kind === 'application' && o.canWrite);
  const canCreatePlatform = !kind.readOnly && !kind.noCreate && !!kind.platformFields && writable({ kind: 'platform' });
  const done = () => {
    setMode(undefined);
    pending.reload();
  };

  if ((kind.live && live.loading) || (declared.loading && !kind.readOnly)) return <Progress />;
  const where = (x?: { r: Row; d?: DeclaredObject }) => {
    if (!x) return undefined;
    const k = x.d ? { owner: x.d.owner } : kind.key?.(x.r);
    if (kind.readOnly) return <Badge label={tx('read only', 'solo lectura')} {...TONES.off} />;
    if (!k) return <Badge label={tx('made outside git', 'creado fuera de git')} {...TONES.warn} />;
    const p = x.d ? pendingFor(pending.data, kind.object, x.d.id) : undefined;
    return (
      <Box sx={{ display: 'inline-flex', gap: 0.5, flexWrap: 'wrap' }}>
        <Badge label={ownerLabel(k.owner, owners.data, es)} outlined />
        {x.d?.gone && <Badge label={tx('removal pending', 'eliminación pendiente')} {...TONES.warn} />}
        {x.d && !x.liveRow && !x.d.gone && <Badge label={tx('declared, not applied yet', 'declarado, aún sin aplicar')} {...TONES.off} />}
        {p && (
          <Box component="a" href={p.url} target="_blank" rel="noreferrer" sx={{ textDecoration: 'none' }}>
            <Badge label={`PR #${p.number}`} {...TONES.warn} />
          </Box>
        )}
      </Box>
    );
  };

  const form = (() => {
    if (!mode || !owners.data) return undefined;
    if (mode.kind === 'delete') {
      return <DeleteConfirm service={kind.service} object={kind.object} what={kind.what} id={mode.d.id} owner={mode.d.owner} onDone={done} onCancel={() => setMode(undefined)} />;
    }
    if (mode.kind === 'create') {
      const fields = mode.platform ? kind.platformFields! : kind.appFields!;
      return (
        <ManageForm
          service={kind.service}
          object={kind.object}
          what={kind.what}
          fields={fields}
          owners={owners.data}
          owner={mode.platform ? { kind: 'platform' } : undefined}
          platform={mode.platform}
          idFromOwner={!mode.platform && kind.idFromOwner}
          onDone={done}
          onCancel={() => setMode(undefined)}
        />
      );
    }
    const d = mode.d;
    const fields = d.owner.kind === 'platform' ? kind.platformFields : kind.appFields;
    return (
      <ManageForm
        key={`${ownerKey(d.owner)}|${d.id}`}
        service={kind.service}
        object={kind.object}
        what={kind.what}
        fields={fields ?? []}
        owners={owners.data}
        owner={d.owner}
        platform={d.owner.kind === 'platform'}
        current={{ ...(kind.values ? kind.values(d) : d.spec), name: d.id }}
        onDone={done}
        onCancel={() => setMode(undefined)}
      />
    );
  })();

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {kind.note && <Typography variant="body2" color="text.secondary">{kind.note}</Typography>}
      {live.error && <WarningPanel title={tx(`Could not read the ${kind.label.toLowerCase()}`, `No se pudieron leer: ${kind.label.toLowerCase()}`)} message={live.error} />}
      {declared.error && !kind.readOnly && <WarningPanel title={tx('Could not read what git declares', 'No se pudo leer lo que declara git')} message={declared.error} />}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField size="small" placeholder={tx(`Search ${kind.label.toLowerCase()}`, `Buscar ${kind.label.toLowerCase()}`)} value={q} onChange={e => { setQ(e.target.value); setSel(0); }} inputProps={{ 'aria-label': `Search ${kind.label}` }} sx={{ minWidth: 240, flex: '1 1 240px' }} />
        {canCreateApp && (
          <Button variant="contained" disableElevation onClick={() => setMode({ kind: 'create', platform: false })} sx={{ textTransform: 'none' }}>
            {tx(`New ${kind.what} of an application`, `Nuevo ${kind.what} de una aplicación`)}
          </Button>
        )}
        {canCreatePlatform && (
          <Button variant={canCreateApp ? 'outlined' : 'contained'} disableElevation onClick={() => setMode({ kind: 'create', platform: true })} sx={{ textTransform: 'none' }}>
            {tx(`New ${kind.what} of the platform`, `Nuevo ${kind.what} de la plataforma`)}
          </Button>
        )}
      </Box>
      {form && <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '8px', p: 2, bgcolor: 'background.paper' }}>{form}</Box>}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 340px' }, alignItems: 'start' }}>
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '8px', p: 1.5, bgcolor: 'background.paper', overflowX: 'auto', minWidth: 0 }}>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, '& th': { textAlign: 'left', fontWeight: 500, color: 'text.secondary', fontSize: 12, p: 1, borderBottom: 1, borderColor: 'divider' }, '& td': { p: 1, borderBottom: 1, borderColor: 'divider', verticalAlign: 'top' } }}>
            <thead>
              <tr>
                {kind.columns.map(c => <th key={c.key}>{c.label}</th>)}
                <th>{tx('Declared in', 'Declarado en')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x, i) => (
                <Box component="tr" key={i} tabIndex={0} onClick={() => setSel(i)} onKeyDown={e => e.key === 'Enter' && setSel(i)}
                  sx={{ cursor: 'pointer', bgcolor: x === picked ? 'action.selected' : undefined, '&:hover td': { bgcolor: 'action.hover' }, opacity: x.d?.gone ? 0.6 : 1 }}>
                  {kind.columns.map(c => <td key={c.key}>{c.render ? c.render(x.r) : String(x.r[c.key] ?? '—')}</td>)}
                  <td>{where(x)}</td>
                </Box>
              ))}
            </tbody>
          </Box>
          {rows.length === 0 && <Typography color="text.secondary" sx={{ p: 1 }}>{q ? tx('Nothing matches.', 'Nada coincide.') : tx('None yet.', 'Aún no hay ninguno.')}</Typography>}
        </Box>
        {picked && (
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '8px', p: 2, bgcolor: 'background.paper', display: 'grid', gap: 1, position: { lg: 'sticky' }, top: 12 }}>
            <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{kind.title(picked.r)}</Typography>
            <Box>{where(picked)}</Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {picked.d && !picked.d.gone && !kind.noEdit && (kind.appFields || kind.platformFields) && writable(picked.d.owner) && (
                <Button size="small" variant="contained" disableElevation onClick={() => setMode({ kind: 'edit', d: picked.d! })} sx={{ textTransform: 'none' }}>
                  {tx('Change', 'Cambiar')}
                </Button>
              )}
              {picked.d && !picked.d.gone && writable(picked.d.owner) && (
                <Button size="small" variant="outlined" color="error" onClick={() => setMode({ kind: 'delete', d: picked.d! })} sx={{ textTransform: 'none' }}>
                  {tx('Remove', 'Eliminar')}
                </Button>
              )}
              {kind.open?.(picked.r, host) && (
                <Button size="small" variant="text" href={kind.open(picked.r, host)!} target="_blank" rel="noreferrer" endIcon={<OpenInNew fontSize="small" />} sx={{ textTransform: 'none', color: rq.primary }}>
                  {tx('See it in the product', 'Verlo en el producto')}
                </Button>
              )}
            </Box>
            {!kind.readOnly && !picked.d && !kind.key?.(picked.r) && (
              <Typography variant="body2" color="text.secondary">
                {tx('It was made outside git, so Manage cannot change it yet. Declaring it in the file of its application is the next step of Manage (migration).',
                  'Se creó fuera de git, así que Manage aún no puede cambiarlo. Declararlo en el fichero de su aplicación es el siguiente paso de Manage (migración).')}
              </Typography>
            )}
            {picked.d && !writable(picked.d.owner) && (
              <Typography variant="body2" color="text.secondary">{tx('Only its team can change it.', 'Solo su equipo puede cambiarlo.')}</Typography>
            )}
            <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '4px 12px', m: 0, fontSize: 14 }}>
              {(kind.facts?.(picked.r) ?? kind.columns.map(c => [c.label, c.render ? c.render(picked.r) : String(picked.r[c.key] ?? '—')] as [string, ReactNode])).map(([k, v]) => (
                <Fragment key={k}>
                  <Box component="dt" sx={{ color: 'text.secondary' }}>{k}</Box>
                  <Box component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>{v}</Box>
                </Fragment>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

/** The tabs of a Manage page, each a kind of object. */
export const ManageTabs = ({ kinds, label }: { kinds: Kind[]; label: string }) => {
  const [tab, setTab] = useState(0);
  const k = kinds[Math.min(tab, kinds.length - 1)];
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box role="tablist" aria-label={label} sx={{ display: 'flex', gap: 0.5, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
        {kinds.map((x, i) => (
          <Button key={x.label} role="tab" aria-selected={tab === i} onClick={() => setTab(i)}
            sx={{ borderRadius: 0, textTransform: 'none', color: tab === i ? 'text.primary' : 'text.secondary', borderBottom: 2, borderColor: tab === i ? rq.blue : 'transparent', mb: '-1px' }}>
            {x.label}
          </Button>
        ))}
      </Box>
      <ManageObjectsView key={`${k.service}/${k.object}/${k.label}`} kind={k} />
    </Box>
  );
};
