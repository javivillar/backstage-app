import { Progress } from '@backstage/core-components';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Close from '@mui/icons-material/Close';
import ExpandMore from '@mui/icons-material/ExpandMore';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  candidates,
  peopleIn,
  productTitle,
  useAccessChange,
  useAccessPerson,
  useAccessProduct,
  useAccessProducts,
  usePeopleSearch,
  type GroupView,
  type GroupWithMembers,
  type Person,
  type ProductSummary,
} from '../accessAdmin';
import { useI18n } from '../i18n';
import { useRq } from '../theme/consoleTheme';
import { EmptyState, Id, Kpis, Pill, Section, TitleRow, choose } from './ui';

type Change = (action: 'add' | 'remove', group: string, username: string) => void;
type Notice = { tone: 'pos' | 'neg'; text: string };

const label = (p: Person) => (p.name ? `${p.name} (${p.username})` : p.username);

/** Picks an existing person by name: the search runs in Keycloak, nothing is created. */
const PersonPicker = ({ id, text, button, exclude = [], busy, onPick }: { id: string; text: string; button: string; exclude?: Person[]; busy?: boolean; onPick: (p: Person) => void }) => {
  const { t } = useI18n();
  const search = usePeopleSearch();
  const [input, setInput] = useState('');
  const [picked, setPicked] = useState<Person | null>(null);
  const [found, setFound] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const needle = input.trim();

  useEffect(() => {
    if (needle.length < 2 || (picked && label(picked) === input)) {
      setFound([]);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    const show = (people: Person[]) => {
      if (!alive) return;
      setFound(people);
      setLoading(false);
    };
    const timer = setTimeout(() => {
      search(needle).then(show, () => show([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [needle, input, picked, search]);

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <Autocomplete
        id={id}
        size="small"
        sx={{ flex: '1 1 260px', maxWidth: 380 }}
        options={candidates(found, exclude)}
        value={picked}
        inputValue={input}
        loading={loading}
        filterOptions={x => x}
        getOptionLabel={label}
        isOptionEqualToValue={(a, b) => a.username === b.username}
        noOptionsText={needle.length < 2 ? t('acc.add.type') : t('acc.add.noOptions')}
        onInputChange={(_, v) => setInput(v)}
        onChange={(_, v) => setPicked(v)}
        renderInput={p => <TextField {...p} label={text} helperText={t('acc.add.hint')} />}
      />
      <Button
        variant="contained"
        disabled={!picked || busy}
        onClick={() => {
          if (!picked) return;
          onPick(picked);
          setPicked(null);
          setInput('');
        }}
        sx={{ mt: '2px' }}
      >
        {button}
      </Button>
    </Box>
  );
};

/** The people of a group, each with its remove button when the group may be changed. */
const Members = ({ group, members, canChange, busy, onChange }: { group: string; members: Person[]; canChange: boolean; busy: boolean; onChange: Change }) => {
  const { t } = useI18n();
  const rq = useRq();
  if (!members.length) return <Typography color="text.secondary">{t('acc.members.none')}</Typography>;
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
      {members.map(m => (
        <Box component="li" key={m.username} title={m.email} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, pl: 1.25, pr: canChange ? 0.25 : 1.25, height: 28, border: `1px solid ${rq.border}`, borderRadius: 999, bgcolor: rq.sheet }}>
          <span>{m.name || m.username}</span>
          {m.name && (
            <Typography component="span" variant="caption" color="text.secondary">
              {m.username}
            </Typography>
          )}
          {canChange && (
            <IconButton size="small" disabled={busy} aria-label={t('acc.remove', { user: m.username, group })} onClick={() => onChange('remove', group, m.username)} sx={{ p: 0.25 }}>
              <Close sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
      ))}
    </Box>
  );
};

/** What kind of group it is, as pills. */
const Tags = ({ group }: { group: GroupView }) => {
  const { t } = useI18n();
  return (
    <>
      {group.kind && <Pill>{group.kind}</Pill>}
      {group.admin && <Pill tone="info" plain>{t('acc.tag.admin')}</Pill>}
      {group.portalOnly && <Pill tone="warn" plain title={t('acc.portalOnly.why')}>{t('acc.tag.portalOnly')}</Pill>}
      {group.from && <Pill plain>{t('acc.tag.from', { product: productTitle(group.from) })}</Pill>}
    </>
  );
};

/** One group of the product: what it gives and, opened, who is in it. */
const GroupRow = ({ group, open, busy, onToggle, onChange }: { group: GroupWithMembers; open: boolean; busy: boolean; onToggle: () => void; onChange: Change }) => {
  const { t } = useI18n();
  const rq = useRq();
  const panel = `acc-members-${group.name}`;
  return (
    <Box sx={{ borderTop: `1px solid ${rq.rule}`, bgcolor: open ? rq.raised : 'transparent' }}>
      <ButtonBase
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panel}
        aria-label={t('acc.show', { group: group.name })}
        sx={{ width: '100%', display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', md: 'minmax(0, 5fr) minmax(0, 6fr) 80px 24px' }, gap: 1.5, alignItems: 'center', textAlign: 'left', px: 2.25, py: 1.25, font: 'inherit', color: 'inherit' }}
      >
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
          <Id>{group.name}</Id>
          <Tags group={group} />
        </Box>
        <Box sx={{ display: { xs: 'none', md: 'block' }, color: 'text.secondary', minWidth: 0, overflowWrap: 'anywhere' }}>{group.grants ?? '—'}</Box>
        <Box sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{group.members.length}</Box>
        <ExpandMore aria-hidden sx={{ display: { xs: 'none', md: 'block' }, fontSize: 20, color: 'text.secondary', transform: open ? 'rotate(180deg)' : 'none' }} />
      </ButtonBase>
      {open && (
        <Box id={panel} sx={{ px: 2.25, pb: 2, display: 'grid', gap: 1.5 }}>
          <Box sx={{ display: { xs: 'block', md: 'none' }, color: 'text.secondary' }}>{group.grants}</Box>
          <Members group={group.name} members={group.members} canChange={group.canChange} busy={busy} onChange={onChange} />
          {group.canChange ? (
            <PersonPicker id={`acc-add-${group.name}`} text={t('acc.add.label')} button={t('acc.add')} exclude={group.members} busy={busy} onPick={p => onChange('add', group.name, p.username)} />
          ) : (
            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', color: 'text.secondary' }}>
              <LockOutlined sx={{ fontSize: 16 }} />
              {t('acc.portalOnly.why')}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

/** The products to pick from, services and applications apart. */
const Picker = ({ products, selected, onPick }: { products: ProductSummary[]; selected?: string; onPick: (component: string) => void }) => {
  const { t } = useI18n();
  const rq = useRq();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = products.filter(p => !needle || p.component.toLowerCase().includes(needle));
  const blocks: Array<[string, ProductSummary[]]> = [
    [t('acc.services'), shown.filter(p => p.kind === 'service')],
    [t('acc.applications'), shown.filter(p => p.kind === 'application')],
  ];
  return (
    <Box component="nav" aria-label={t('acc.products')} sx={{ flex: '1 0 240px', maxWidth: { md: 280 }, display: 'grid', gap: 1.5, alignContent: 'start' }}>
      {products.length > 8 && <TextField id="acc-product-search" size="small" label={t('acc.search')} value={q} onChange={e => setQ(e.target.value)} />}
      {!shown.length && <Typography color="text.secondary">{t('acc.noMatch', { q })}</Typography>}
      {blocks
        .filter(([, list]) => list.length)
        .map(([title, list]) => (
          <Box key={title} sx={{ display: 'grid', gap: 0.25 }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', px: 1.25 }}>
              {title}
            </Typography>
            {list.map(p => {
              const on = p.component === selected;
              return (
                <ButtonBase
                  key={p.component}
                  onClick={() => onPick(p.component)}
                  aria-current={on ? 'true' : undefined}
                  sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, px: 1.25, py: 1, borderRadius: '6px', font: 'inherit', color: 'inherit', textAlign: 'left', fontWeight: on ? 600 : 400, bgcolor: on ? rq.active : 'transparent', '&:hover': { bgcolor: on ? rq.active : rq.raised } }}
                >
                  <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    {productTitle(p.component)}
                  </Box>
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {p.groups === 1 ? t('acc.groups.1') : t('acc.groups.n', { n: p.groups })}
                  </Typography>
                </ButtonBase>
              );
            })}
          </Box>
        ))}
    </Box>
  );
};

/**
 * Portal › Manage › Access administration: the administrators of a product (the members of its administrator group)
 * put existing people in the Keycloak groups of that product and name other administrators; the administrators of
 * the portal do it for every product. People are never created here. The backend (keycloak-backend accessRoutes.ts)
 * decides who may do what and records every change. The state is in the URL (?product&person).
 */
export const AccessAdminPage = () => {
  const { t, lang } = useI18n();
  const rq = useRq();
  const [params, setParams] = useSearchParams();
  const products = useAccessProducts();
  const list = products.data?.products ?? [];
  const selected = list.find(p => p.component === params.get('product')) ?? list[0];
  const product = useAccessProduct(selected?.component);
  const personName = params.get('person') ?? undefined;
  const person = useAccessPerson(list.length ? personName : undefined);
  const change = useAccessChange();
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v === undefined ? next.delete(k) : next.set(k, v)));
    setParams(next, { replace: true });
  };

  const onChange: Change = (action, group, username) => {
    setBusy(true);
    setNotice(undefined);
    change(action, group, username)
      .then(
        done => setNotice({ tone: 'pos', text: t(choose([[done.pending, 'acc.done.proposed'], [action === 'add', 'acc.done.add']], 'acc.done.remove'), { user: username, group }) }),
        e => setNotice({ tone: 'neg', text: t('acc.failed', { why: (e as Error).message }) }),
      )
      .finally(() => {
        setBusy(false);
        product.reload();
        person.reload();
      });
  };

  const crumbs: Array<[string, string?]> = [['Portal', '/console'], [t('nav.manage'), '/console/manage'], [t('acc.title')]];
  if (products.loading) return <Progress />;
  if (products.error) {
    return (
      <>
        <TitleRow crumbs={crumbs} title={t('acc.title')} />
        <EmptyState tone="neg" title={t('acc.error')}>
          {products.error}
        </EmptyState>
      </>
    );
  }
  if (!list.length) {
    return (
      <>
        <TitleRow crumbs={crumbs} title={t('acc.title')} />
        <EmptyState title={t('acc.none')}>{t('acc.none.why')}</EmptyState>
      </>
    );
  }

  const detail = product.data;
  const admins = detail?.groups.filter(g => g.admin) ?? [];
  const title = selected ? productTitle(selected.component) : '';
  const adminsNote = choose<string>(
    [
      [admins.length, t('acc.admins.how', { group: admins.map(g => g.name).join(', ') })],
      [detail?.kind === 'application', t('acc.admins.owners')],
    ],
    t('acc.admins.none'),
  );

  return (
    <>
      <TitleRow crumbs={crumbs} title={t('acc.title')} sub={t(products.data?.portalAdmin ? 'acc.sub.portal' : 'acc.sub.product')} />
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Picker
          products={list}
          selected={selected?.component}
          onPick={component => {
            setOpen(undefined);
            setNotice(undefined);
            set({ product: component });
          }}
        />
        <Box sx={{ flex: '999 1 480px', minWidth: 0 }}>
          {notice && (
            <Box role="status" sx={{ mb: 2, px: 1.5, py: 1, borderRadius: '6px', bgcolor: rq[notice.tone].bg, color: rq[notice.tone].fg }}>
              {notice.text}
            </Box>
          )}
          {product.loading && !detail && <Progress />}
          {product.error && (
            <EmptyState tone="neg" title={t('acc.error')}>
              {product.error}
            </EmptyState>
          )}
          {detail && (
            <>
              <Kpis
                items={[
                  { label: t('acc.kpi.admins'), value: peopleIn(admins) },
                  { label: t('acc.kpi.groups'), value: detail.groups.length },
                  { label: t('acc.kpi.people'), value: peopleIn(detail.groups) },
                  { label: t('acc.kpi.changes'), value: detail.changes.length },
                ]}
              />

              <Section title={t('acc.admins', { product: title })}>
                <Box sx={{ display: 'grid', gap: 1.5 }}>
                  <Typography color="text.secondary">{adminsNote}</Typography>
                  {admins.map(g => (
                    <Box key={g.name} sx={{ display: 'grid', gap: 1.5 }}>
                      <Members group={g.name} members={g.members} canChange={g.canChange} busy={busy} onChange={onChange} />
                      {g.canChange ? (
                        <PersonPicker id={`acc-admin-${g.name}`} text={t('acc.add.label')} button={t('acc.add.admin')} exclude={g.members} busy={busy} onPick={p => onChange('add', g.name, p.username)} />
                      ) : (
                        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', color: 'text.secondary' }}>
                          <LockOutlined sx={{ fontSize: 16 }} />
                          {t('acc.portalOnly.why')}
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>
              </Section>

              <Section title={t('acc.groups')} meta={t('acc.groups.meta')} flush>
                <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 6fr) 80px 24px', gap: 1.5, px: 2.25, pb: 1, fontSize: 12, color: 'text.secondary' }}>
                  <span>{t('acc.col.group')}</span>
                  <span>{t('acc.col.grants')}</span>
                  <Box component="span" sx={{ textAlign: 'right' }}>
                    {t('acc.col.members')}
                  </Box>
                  <span />
                </Box>
                {detail.groups.map(g => (
                  <GroupRow key={g.name} group={g} open={open === g.name} busy={busy} onToggle={() => setOpen(open === g.name ? undefined : g.name)} onChange={onChange} />
                ))}
              </Section>

              <Section title={t('acc.changes')}>
                {!detail.recorded && <EmptyState tone="neg" title={t('acc.changes.off')} />}
                {detail.recorded && !detail.changes.length && <Typography color="text.secondary">{t('acc.changes.none')}</Typography>}
                {detail.changes.length > 0 && (
                  <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th': { textAlign: 'left', fontWeight: 500, fontSize: 12, color: 'text.secondary', pb: 0.75, pr: 2 }, '& td': { py: 0.75, pr: 2, borderTop: `1px solid ${rq.rule}`, verticalAlign: 'top' } }}>
                    <thead>
                      <tr>
                        <th>{t('acc.col.when')}</th>
                        <th>{t('acc.col.who')}</th>
                        <th>{t('acc.col.change')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.changes.map((c, i) => (
                        <tr key={`${c.at}-${i}`}>
                          <Box component="td" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                            {new Date(c.at).toLocaleString(lang)}
                          </Box>
                          <td>{c.actor.replace(/^user:[^/]+\//, '')}</td>
                          <td>{t(c.action === 'add' ? 'acc.change.add' : 'acc.change.remove', { user: c.username, group: c.group })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Box>
                )}
              </Section>
            </>
          )}

          <Section title={t('acc.person')} meta={t('acc.person.meta')}>
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              <PersonPicker id="acc-person" text={t('acc.person.label')} button={t('acc.search')} onPick={p => set({ person: p.username })} />
              {person.loading && <Progress />}
              {person.error && (
                <EmptyState tone="neg" title={t('acc.error')}>
                  {person.error}
                </EmptyState>
              )}
              {person.data && (
                <>
                  <Box component="b" sx={{ fontWeight: 500 }}>
                    {label(person.data.person)}
                  </Box>
                  {person.data.hub && (
                    <Box sx={{ px: 1.5, py: 1, borderRadius: '6px', bgcolor: rq.warn.bg, color: rq.warn.fg }}>{t('acc.person.hub', { user: person.data.person.username, hub: person.data.hub })}</Box>
                  )}
                  {!person.data.groups.length && <Typography color="text.secondary">{t('acc.person.none', { user: person.data.person.username })}</Typography>}
                  {person.data.groups.map(g => (
                    <Box key={`${g.component}/${g.name}`} sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', md: '140px minmax(0, 4fr) minmax(0, 5fr) auto' }, gap: 1.5, alignItems: 'center', borderTop: `1px solid ${rq.rule}`, pt: 1 }}>
                      <Box sx={{ display: { xs: 'none', md: 'block' } }}>{productTitle(g.component)}</Box>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                        <Id>{g.name}</Id>
                        <Tags group={g} />
                      </Box>
                      <Box sx={{ display: { xs: 'none', md: 'block' }, color: 'text.secondary', minWidth: 0 }}>{g.grants ?? '—'}</Box>
                      {g.canChange && !person.data?.hub ? (
                        <IconButton size="small" disabled={busy} aria-label={t('acc.remove', { user: person.data?.person.username ?? '', group: g.name })} onClick={() => onChange('remove', g.name, person.data?.person.username ?? '')}>
                          <Close sx={{ fontSize: 18 }} />
                        </IconButton>
                      ) : (
                        <LockOutlined aria-label={t('acc.tag.portalOnly')} sx={{ fontSize: 16, color: 'text.secondary' }} />
                      )}
                    </Box>
                  ))}
                </>
              )}
            </Box>
          </Section>
        </Box>
      </Box>
    </>
  );
};
