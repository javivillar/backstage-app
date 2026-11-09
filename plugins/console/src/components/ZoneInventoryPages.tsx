import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useRq } from '../theme/consoleTheme';
import type { Inventory } from '../zone';
import { Badge } from './Badge';
import { TONES } from './Flow';
import { Card } from './NamespaceSections';
import { Table } from './NetworkPage';
import { Id, Kpis, Meter } from './ui';
import { ZoneFrame } from './ZonePages';

/**
 * Templates and Storage of the zone pages: a read-only copy of those sections of OpenNebula, as the host publishes
 * them in topology.json (inventory). Nothing here creates or changes anything.
 */

const mb = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(v >= 10240 ? 0 : 1)} GiB` : `${v} MB`);
const day = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '—');
const list = (v: string[]) => (v.length ? v.join(', ') : '—');

const imageTone = (state: string) => {
  if (/ERROR/.test(state)) return TONES.bad;
  if (/LOCKED|DISABLED|DELETE|CLONE|INIT/.test(state)) return TONES.warn;
  return TONES.ok;
};

/** The tabs of a page, kept in ?tab= so a link opens the same one. */
function useTab<T extends string>(tabs: readonly T[]): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as T | null;
  const tab = asked && tabs.includes(asked) ? asked : tabs[0];
  return [tab, t => setParams({ tab: t }, { replace: true })];
}

const PageTabs = <T extends string>({ tabs, tab, onChange, label }: { tabs: Array<[T, string]>; tab: T; onChange: (t: T) => void; label: string }) => {
  const rq = useRq();
  return (
    <Tabs value={tab} onChange={(_, v) => onChange(v)} aria-label={label} variant="scrollable" sx={{ borderBottom: `1px solid ${rq.border}` }}>
      {tabs.map(([k, l]) => (
        <Tab key={k} value={k} label={l} sx={{ textTransform: 'none' }} />
      ))}
    </Tabs>
  );
};

/** The host did not publish the inventory (an older topology.py, or OpenNebula not read). */
const NoInventory = () => {
  const { t } = useI18n();
  return <Typography color="text.secondary">{t('inv.none')}</Typography>;
};

// ------------------------------------------------------------------ Templates

const TPL_TABS = ['vm', 'service', 'vrouter', 'vmgroup', 'vntemplate'] as const;
type TplTab = (typeof TPL_TABS)[number];
type TplRow = { id: string; name: string; cells: ReactNode[]; created: string; text: string };

function templateRows(inv: Inventory, tab: TplTab): TplRow[] {
  switch (tab) {
    case 'vm':
    case 'vrouter':
      return inv.vmTemplates
        .filter(x => x.vrouter === (tab === 'vrouter'))
        .map(x => ({
          id: x.id,
          name: x.name,
          cells: [`${x.vcpu ?? x.cpu ?? '?'} vCPU · ${mb(x.memoryMb)}`, list(x.disks), list(x.networks)],
          created: list(x.instances),
          text: x.text,
        }));
    case 'service':
      return inv.serviceTemplates.map(x => ({
        id: x.id,
        name: x.name,
        cells: [x.roles.map(r => `${r.name} ×${r.cardinality ?? '?'}`).join(' · ') || '—', x.deployment ?? '—', list(x.networks)],
        created: list(x.instances.map(i => (i.state ? `${i.name} (${i.state})` : i.name))),
        text: x.text,
      }));
    case 'vmgroup':
      return inv.vmGroups.map(x => ({
        id: x.id,
        name: x.name,
        cells: [x.roles.map(r => r.name).join(' · ') || '—', x.roles.map(r => r.policy).filter(Boolean).join(' · ') || '—', '—'],
        created: list(x.roles.flatMap(r => r.vms)),
        text: x.text,
      }));
    default:
      return inv.vnTemplates.map(x => ({ id: x.id, name: x.name, cells: [x.driver ?? '—', x.vlan ?? '—', list(x.ranges)], created: '—', text: x.text }));
  }
}

const TemplatesBody = ({ inv }: { inv: Inventory }) => {
  const { t } = useI18n();
  const rq = useRq();
  const [tab, setTab] = useTab(TPL_TABS);
  const [picked, setPicked] = useState<string>();
  const rows = templateRows(inv, tab);
  const sel = rows.find(r => r.id === picked) ?? rows[0];
  const heads: Record<TplTab, string[]> = {
    vm: [t('inv.capacity'), t('inv.disks'), t('inv.networks')],
    vrouter: [t('inv.capacity'), t('inv.disks'), t('inv.networks')],
    service: [t('inv.roles'), t('inv.deployment'), t('inv.networks')],
    vmgroup: [t('inv.roles'), t('inv.policy'), '—'],
    vntemplate: [t('inv.driver'), 'VLAN', t('inv.ranges')],
  };
  const count = (k: TplTab) => templateRows(inv, k).length;
  return (
    <>
      <PageTabs label={t('nav.templates')} tab={tab} onChange={k => { setTab(k); setPicked(undefined); }} tabs={TPL_TABS.map(k => [k, `${t(`inv.tpl.${k}`)} · ${count(k)}`])} />
      {rows.length === 0 ? (
        <Typography color="text.secondary">{t('inv.tplEmpty', { kind: t(`inv.tpl.${tab}`).toLowerCase() })}</Typography>
      ) : (
        <>
          <Card title={t('inv.tplCount', { n: rows.length })} sub={t('inv.tplSub')}>
            <Table
              head={['ID', t('inv.template'), ...heads[tab], t('inv.createdFrom')]}
              rows={rows.map(r => [
                <Id>{r.id}</Id>,
                <Box
                  component="button"
                  type="button"
                  onClick={() => setPicked(r.id)}
                  aria-pressed={sel?.id === r.id}
                  sx={{ background: 'none', border: 0, p: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer', color: rq.ink, fontWeight: sel?.id === r.id ? 600 : 400, textDecoration: 'underline', textUnderlineOffset: 3 }}
                >
                  {r.name}
                </Box>,
                ...r.cells,
                r.created,
              ])}
            />
          </Card>
          {sel && (
            <Card title={sel.name} sub={t('inv.definition', { created: sel.created })}>
              <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: rq.raised, borderRadius: '6px', fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                {sel.text || '—'}
              </Box>
            </Card>
          )}
        </>
      )}
    </>
  );
};

export const ZoneTemplatesPage = () => {
  const { t } = useI18n();
  return (
    <ZoneFrame title={t('nav.templates')} finding={(_, view) => (view.inventory ? t('inv.tplFinding', { n: view.inventory.vmTemplates.length + view.inventory.serviceTemplates.length }) : undefined)}>
      {(_, view) => (view.inventory ? <TemplatesBody inv={view.inventory} /> : <NoInventory />)}
    </ZoneFrame>
  );
};

// ------------------------------------------------------------------ Storage

const ST_TABS = ['images', 'datastores', 'backups'] as const;

const JobState = ({ errors, outdated }: { errors: number; outdated: number }) => {
  const { t } = useI18n();
  if (errors) return <Badge label={t('inv.bkErrors', { n: errors })} {...TONES.bad} />;
  if (outdated) return <Badge label={t('inv.bkOutdated', { n: outdated })} {...TONES.warn} />;
  return <Badge label="OK" {...TONES.ok} />;
};

/** A VM with backups is fine; one with persistent disks and none is what to look at. */
const VmBackupState = ({ count, persistentDisks }: { count: number; persistentDisks: number }) => {
  const { t } = useI18n();
  if (count > 0) return <Badge label="OK" {...TONES.ok} />;
  if (persistentDisks > 0) return <Badge label={t('inv.bkMissing')} {...TONES.warn} />;
  return <Badge label={t('inv.bkNone')} {...TONES.off} />;
};

const StorageBody = ({ inv }: { inv: Inventory }) => {
  const { t } = useI18n();
  const [tab, setTab] = useTab(ST_TABS);
  const images = inv.images.filter(i => i.type !== 'BACKUP');
  const backups = inv.images.filter(i => i.type === 'BACKUP');
  const withBackup = inv.vmBackups.filter(b => b.count > 0).length;
  const last = inv.vmBackups.map(b => b.last).filter(Boolean).sort().pop();
  const backupDs = inv.datastores.filter(d => d.type === 'backup');
  return (
    <>
      <PageTabs
        label={t('nav.zoneStorage')}
        tab={tab}
        onChange={setTab}
        tabs={[
          ['images', `${t('inv.images')} · ${images.length}`],
          ['datastores', `${t('inv.datastores')} · ${inv.datastores.length}`],
          ['backups', `${t('inv.backups')} · ${backups.length}`],
        ]}
      />
      {tab === 'images' && (
        <Card title={t('inv.imgCount', { n: images.length })} sub={t('inv.imgSub')}>
          <Table
            head={['ID', t('inv.image'), t('inv.type'), t('inv.datastore'), t('inv.size'), t('inv.persistent'), t('zone.state'), t('inv.usedBy')]}
            rows={images.map(i => [<Id>{i.id}</Id>, i.name, i.type, <Id>{i.datastore}</Id>, mb(i.sizeMb), i.persistent ? t('inv.yes') : t('inv.no'), <Badge label={i.state} {...imageTone(i.state)} />, list(i.vms)])}
          />
        </Card>
      )}
      {tab === 'datastores' && (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {inv.datastores.map(d => (
            <Card key={d.id} title={d.name} sub={`ID ${d.id} · ${t(`inv.ds.${d.type}`)} · ${[d.dsMad, d.tmMad].filter(Boolean).join(' / ')}`}>
              <Meter value={d.usedMb} max={d.totalMb} label={t('inv.dsUsed', { used: mb(d.usedMb), total: mb(d.totalMb), free: mb(d.freeMb) })} />
              <Typography variant="body2" color="text.secondary">
                {t('inv.dsImages', { n: d.images })} · {d.state === 'READY' ? <Badge label="READY" {...TONES.ok} /> : <Badge label={d.state} {...TONES.warn} />}
              </Typography>
            </Card>
          ))}
        </Box>
      )}
      {tab === 'backups' && (
        <>
          <Kpis
            items={[
              { label: t('inv.bkJobs'), value: inv.backupJobs.length },
              { label: t('inv.bkVms'), value: `${withBackup} / ${inv.vmBackups.length}` },
              { label: t('inv.bkLast'), value: last ? new Date(last).toLocaleDateString() : t('inv.never') },
              { label: t('inv.bkDs'), value: backupDs.length ? backupDs.map(d => `${mb(d.usedMb)} / ${mb(d.totalMb)}`).join(' · ') : t('inv.bkNoDs'), tone: backupDs.length ? undefined : 'bad' },
            ]}
          />
          <Card title={t('inv.bkJobs')} sub={t('inv.bkJobsSub')}>
            {inv.backupJobs.length === 0 ? (
              <Typography color="text.secondary">{t('inv.bkNoJobs')}</Typography>
            ) : (
              <Table
                head={[t('inv.job'), 'VMs', t('inv.schedule'), t('inv.keep'), t('inv.mode'), t('inv.lastRun'), t('zone.state')]}
                rows={inv.backupJobs.map(j => [
                  <Id>{j.name}</Id>,
                  list(j.vms),
                  list(j.schedule),
                  j.keepLast ?? '—',
                  j.mode ?? '—',
                  day(j.last),
                  <JobState errors={j.errors} outdated={j.outdated} />,
                ])}
              />
            )}
          </Card>
          <Card title={t('nav.vms')} sub={t('inv.bkVmsSub')}>
            <Table
              head={['VM', t('inv.job'), t('inv.bkCount'), t('inv.bkLast'), t('zone.state')]}
              rows={[...inv.vmBackups]
                .sort((a, b) => Number(a.count > 0) - Number(b.count > 0) || b.persistentDisks - a.persistentDisks || a.vm.localeCompare(b.vm))
                .map(b => [
                  <Id>{b.vm}</Id>,
                  b.job ? inv.backupJobs.find(j => j.id === b.job)?.name ?? b.job : '—',
                  String(b.count),
                  day(b.last),
                  <VmBackupState count={b.count} persistentDisks={b.persistentDisks} />,
                ])}
            />
          </Card>
        </>
      )}
    </>
  );
};

export const ZoneStoragePage = () => {
  const { t } = useI18n();
  return (
    <ZoneFrame
      title={t('nav.zoneStorage')}
      finding={(_, view) => {
        const inv = view.inventory;
        if (!inv) return undefined;
        const missing = inv.vmBackups.filter(b => b.count === 0 && b.persistentDisks > 0).length;
        return missing ? t('inv.stFinding', { n: missing }) : t('inv.stFindingOk', { n: inv.images.filter(i => i.type !== 'BACKUP').length, d: inv.datastores.length });
      }}
    >
      {(_, view) => (view.inventory ? <StorageBody inv={view.inventory} /> : <NoInventory />)}
    </ZoneFrame>
  );
};
