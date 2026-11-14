import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { type Organisation, type OrganisationData, type OrganisationPreview, peopleOf, type PullAnswer, type Side, useBusinessMapPost } from '../../organisation';
import { TONES } from '../Flow';
import { Table } from '../NetworkPage';
import { EmptyState, Id, Section } from '../ui';
import { useTemplateDownload } from './OrganisationPage';
import { Choice, KeycloakPill, OrganisationFrame, PersonCell, useSide } from './OrgParts';

const SHOWN = 25;
const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`${file.name} could not be read.`));
    r.readAsDataURL(file);
  });
/** What the backend takes back: the organisation without what the portal added to it. */
const plain = (o: Organisation) => ({
  title: o.title,
  head: o.head && { name: o.head.name, user: o.head.user, role: o.head.role },
  units: o.units.map(u => ({ name: u.name, head: u.head && { name: u.head.name, user: u.head.user, role: u.head.role }, teams: u.teams.map(x => ({ name: x.name, people: x.people.map(p => ({ name: p.name, user: p.user, role: p.role })) })) })),
  productOwners: o.productOwners,
});

const Form = ({ data, side, setSide }: { data: OrganisationData; side: Side; setSide: (s: Side) => void }) => {
  const { t } = useI18n();
  const post = useBusinessMapPost();
  const tpl = useTemplateDownload(data.namespace, side);
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<OrganisationPreview>();
  const [opened, setOpened] = useState<number>();
  const current = data[side];
  const reset = () => {
    setPreview(undefined);
    setError(undefined);
    setOpened(undefined);
    if (input.current) input.current.value = '';
  };
  const read = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setPreview(undefined);
    setOpened(undefined);
    try {
      setPreview(await post<OrganisationPreview>('/organisation/preview', { side, namespace: data.namespace, title: title.trim() || undefined, file: await readAsDataUrl(file), fileName: file.name }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!preview) return;
    setBusy(true);
    setError(undefined);
    try {
      const a = await post<PullAnswer>('/organisation', { side, namespace: data.namespace, organisation: plain(preview.organisation) });
      setOpened(a.pull.number);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data.namespace) return <EmptyState title={t('org.noCustomer')} />;
  if (!data.may) return <EmptyState title={t('orgi.onlyWriters')} />;
  const people = preview ? peopleOf(preview.organisation) : [];
  const missing = people.filter(p => p.inKeycloak === false);
  const owns = (user: string) => preview?.organisation.productOwners.filter(p => p.user === user).map(p => p.application).join(', ');
  const position = (p: (typeof people)[number]) => {
    if (p.position === 'head') return t('orgi.pos.head');
    return p.position === 'unit head' ? t('orgi.pos.unitHead') : p.team ?? '';
  };
  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <Choice
          label={t('org.side')}
          value={side}
          onChange={s => {
            setSide(s);
            reset();
          }}
          options={[['customer', t('org.side.customer')], ['provider', t('org.side.provider')]]}
        />
        <Typography variant="caption" color="text.secondary">
          {t('orgi.which')}
        </Typography>
      </Box>
      <Section title={t('orgi.step.template')}>
        <Box sx={{ display: 'grid', gap: 1.5, justifyItems: 'start' }}>
          <Typography variant="body2">{t('orgi.step.templateSub')}</Typography>
          <Button variant="outlined" size="small" onClick={tpl.download}>
            {t('orgi.download')}
          </Button>
          {tpl.error && <Typography color="error">{tpl.error}</Typography>}
        </Box>
      </Section>
      <Section title={t('orgi.step.file')}>
        <Box sx={{ display: 'grid', gap: 1.5, justifyItems: 'start' }}>
          <TextField size="small" label={t('orgi.name')} value={title} placeholder={current?.title ?? data.namespace} onChange={e => setTitle(e.target.value)} sx={{ minWidth: 320 }} InputLabelProps={{ shrink: true }} />
          <input ref={input} type="file" accept=".xlsx,.csv" aria-label={t('orgi.fileLabel')} style={{ display: 'none' }} onChange={e => read(e.target.files?.[0])} />
          <Button variant="contained" disableElevation disabled={busy} onClick={() => input.current?.click()}>
            {t('orgi.choose')}
          </Button>
          {busy && !preview && <Typography color="text.secondary">{t('orgi.reading')}</Typography>}
          {error && (
            <Typography role="alert" color="error">
              {error}
            </Typography>
          )}
        </Box>
      </Section>
      {preview && (
        <Section title={t('orgi.preview', { file: preview.fileName })} flush>
          <Box sx={{ px: 2.25, pb: 1.5, display: 'grid', gap: 1.25 }}>
            <Typography variant="body2">
              {t('orgi.read', { units: preview.counts.units, teams: preview.counts.teams, people: preview.counts.people, owners: preview.counts.productOwners })}{' '}
              {t(preview.replaces ? 'orgi.replaces' : 'orgi.new')}
            </Typography>
            {!preview.keycloak && <Box sx={{ bgcolor: TONES.info.bg, color: TONES.info.fg, borderRadius: '8px', p: 1.25 }}>{t('orgi.kcUnknown')}</Box>}
            {preview.keycloak && missing.length > 0 && (
              <Box sx={{ bgcolor: TONES.warn.bg, color: TONES.warn.fg, borderRadius: '8px', p: 1.25 }}>
                {t('orgi.missing', { n: missing.length, users: missing.slice(0, 12).map(p => p.user).join(', ') + (missing.length > 12 ? '…' : '') })}
              </Box>
            )}
            {preview.keycloak && missing.length === 0 && <Box sx={{ bgcolor: TONES.ok.bg, color: TONES.ok.fg, borderRadius: '8px', p: 1.25 }}>{t('orgi.allFound')}</Box>}
            {preview.errors.length > 0 && (
              <Box sx={{ bgcolor: TONES.bad.bg, color: TONES.bad.fg, borderRadius: '8px', p: 1.25 }}>
                <b style={{ fontWeight: 500 }}>{t('orgi.errors', { n: preview.errors.length })}</b>
                <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                  {preview.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>
                      {t('orgi.row', { n: e.row })}: {e.message}
                    </li>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
          <Table
            head={[t('orgi.col.unit'), t('orgi.col.team'), t('org.col.person'), t('orgi.col.role'), t('orgi.col.owns'), ...(preview.keycloak ? [t('org.col.keycloak')] : [])]}
            rows={people.slice(0, SHOWN).map(p => [
              p.unit ?? '—',
              position(p),
              <PersonCell key="p" person={p} />,
              p.role ?? '—',
              owns(p.user) ? <Id key="o">{owns(p.user)}</Id> : '—',
              ...(preview.keycloak ? [<KeycloakPill key="k" inKeycloak={p.inKeycloak} />] : []),
            ])}
          />
          <Box sx={{ px: 2.25, py: 1.5, display: 'grid', gap: 1.25 }}>
            {people.length > SHOWN && (
              <Typography variant="caption" color="text.secondary">
                {t('orgi.showing', { shown: SHOWN, all: people.length })}
              </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="contained" disableElevation disabled={busy || opened !== undefined || people.length === 0} onClick={save}>
                {t('orgi.open')}
              </Button>
              <Button variant="outlined" onClick={reset}>
                {t('orgi.another')}
              </Button>
            </Box>
            {opened !== undefined && (
              <Box role="status" sx={{ bgcolor: TONES.ok.bg, color: TONES.ok.fg, borderRadius: '8px', p: 1.25 }}>
                {t('orgi.opened', { n: opened })} <Link to={`/console/business-map/organisation?ns=${encodeURIComponent(data.namespace)}&side=${side}`}>{t('bm.view.organisation')}</Link>
              </Box>
            )}
          </Box>
        </Section>
      )}
    </>
  );
};

/** Business continuity › Organisation › Import: an organisation from the Excel template, previewed, then a pull request. */
export const ImportOrganisationPage = () => {
  const { t } = useI18n();
  const [side, setSide] = useSide();
  return (
    <OrganisationFrame view={t('orgi.title')} title={t('orgi.title')} sub={t('orgi.sub')}>
      {data => <Form key={`${data.namespace}/${side}`} data={data} side={side} setSide={setSide} />}
    </OrganisationFrame>
  );
};
