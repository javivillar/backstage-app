import { type Entity, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { Link } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { EntityProvider, catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';
import { MONO } from '../theme/consoleTheme';
import { openApiOperations } from './EntityBuild';
import { Method } from './ui-portal';
import { classify } from './classify';
import { type Instance, businessServiceView, isBusinessService } from './businessService';
import { ClassicFrame } from './ClassicFrame';
import { EmptyState, Facts, Id, Kpis, Pill, Row, Section, TitleRow } from './ui';

/**
 * The console's own pages for the kinds that are not applications or services: an API (overview and definition),
 * a group (members and what it owns) and a system (its parts). Everything links inside the console.
 */

const NATIVE_KINDS = new Set(['api', 'group', 'system']);
export const hasNativePage = (e: Entity) => NATIVE_KINDS.has(e.kind.toLowerCase());

/** kind:ns/name → its page in the console. */
export const consoleRefPath = (ref: string) => {
  const r = parseEntityRef(ref);
  return `/console/entity/${r.namespace}/${r.kind.toLowerCase()}/${r.name}`;
};
const refName = (ref?: string) => (ref ? parseEntityRef(ref, { defaultKind: 'group' }).name : undefined);
const related = (e: Entity, type: string) => (e.relations ?? []).filter(r => r.type === type).map(r => r.targetRef);

/** The entities of some refs, read once from the catalog. */
function useEntities(refs: string[]): Entity[] | undefined {
  const catalog = useApi(catalogApiRef);
  const key = refs.join(',');
  const [items, setItems] = useState<Entity[] | undefined>();
  useEffect(() => {
    let alive = true;
    if (!refs.length) {
      setItems([]);
      return undefined;
    }
    catalog.getEntitiesByRefs({ entityRefs: refs }).then(
      r => alive && setItems(r.items.filter((x): x is Entity => !!x)),
      () => alive && setItems([]),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, key]);
  return items;
}

const RefLink = ({ refStr, label }: { refStr: string; label?: string }) => <Link to={consoleRefPath(refStr)}>{label ?? parseEntityRef(refStr).name}</Link>;
const titleOf = (e: Entity) => e.metadata.title ?? e.metadata.name;

/** What an entity is: business application or service, development service, else its kind. */
const KindCell = ({ e }: { e: Entity }) => {
  const { t } = useI18n();
  const k = classify(e);
  if (k === 'business' && e.kind === 'System') return <Pill tone="pos" plain>{t('native.bs.pill')}</Pill>;
  if (k === 'business') return <Pill tone="pos" plain>{t('cat.businessApp')}</Pill>;
  if (k === 'development') return <Pill plain>{t('ent.development')}</Pill>;
  return <>{e.kind}</>;
};

/** A table of catalog entities: name (console link), kind, type and lifecycle. */
const EntityTable = ({ items, compact }: { items: Entity[]; compact?: boolean }) => {
  const { t } = useI18n();
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{t('native.name')}</TableCell>
          <TableCell>{t('native.kind')}</TableCell>
          {!compact && <TableCell>{t('native.type')}</TableCell>}
          {!compact && <TableCell>{t('native.lifecycle')}</TableCell>}
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map(e => (
          <TableRow key={stringifyEntityRef(e)} hover>
            <TableCell>
              <Link to={consoleRefPath(stringifyEntityRef(e))} style={{ fontWeight: 500 }}>
                {titleOf(e)}
              </Link>
              {e.metadata.description && (
                <Typography variant="caption" color="text.secondary" component="div" sx={{ maxWidth: 560 }}>
                  {e.metadata.description}
                </Typography>
              )}
            </TableCell>
            <TableCell>
              <KindCell e={e} />
            </TableCell>
            {!compact && <TableCell>{String(e.spec?.type ?? '—')}</TableCell>}
            {!compact && <TableCell>{String(e.spec?.lifecycle ?? '—')}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

/* ---------------- API ---------------- */

const OperationsTable = ({ ops }: { ops: ReturnType<typeof openApiOperations> }) => {
  const { t } = useI18n();
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{t('native.api.method')}</TableCell>
          <TableCell>{t('native.api.path')}</TableCell>
          <TableCell>{t('native.api.summary')}</TableCell>
          <TableCell>{t('native.api.protection')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {ops.map(o => (
          <TableRow key={`${o.method} ${o.path}`} hover>
            <TableCell>
              <Method method={o.method} />
            </TableCell>
            <TableCell>
              <Id>{o.path}</Id>
            </TableCell>
            <TableCell>{o.summary ?? ''}</TableCell>
            <TableCell>{o.open ? <Pill tone="warn">{t('native.api.noAuth')}</Pill> : <Pill tone="pos">{t('native.api.auth')}</Pill>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};


const ApiPage = ({ entity, apiDefinition }: { entity: Entity; apiDefinition?: ReactNode }) => {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const base = consoleRefPath(stringifyEntityRef(entity));
  const onDefinition = pathname.replace(/\/+$/, '').endsWith('/definition');
  const definition = String(entity.spec?.definition ?? '');
  const type = String(entity.spec?.type ?? '');
  const ops = useMemo(() => (type === 'openapi' ? openApiOperations(definition) : []), [type, definition]);
  const open = ops.filter(o => o.open).length;
  const providers = related(entity, 'apiProvidedBy');
  const consumers = related(entity, 'apiConsumedBy');
  const users = useEntities(consumers);
  const owner = refName(String(entity.spec?.owner ?? ''));
  const system = entity.spec?.system ? String(entity.spec.system) : undefined;
  let finding: string | undefined;
  if (type === 'openapi') finding = open ? t('native.api.open', { n: open }) : t('native.api.allAuth');
  return (
    <>
      <TitleRow
        crumbs={[[t('nav.portal'), '/console'], ['APIs', '/console/apis'], [titleOf(entity)]]}
        title={titleOf(entity)}
        pills={
          <>
            <Pill tone="info" plain>
              API · {type || '—'}
            </Pill>
            {entity.spec?.lifecycle && <Pill plain>{String(entity.spec.lifecycle)}</Pill>}
          </>
        }
        sub={entity.metadata.description}
        finding={finding}
        findingTone={open ? 'warn' : 'pos'}
      />
      <Box component="nav" aria-label={t('native.sections')} sx={{ display: 'flex', gap: 0.5, borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        {[
          [t('nav.overview'), base, !onDefinition],
          [t('native.definition'), `${base}/definition`, onDefinition],
        ].map(([label, to, on]) => (
          <Link key={String(to)} to={String(to)} aria-current={on ? 'page' : undefined} style={{ padding: '8px 12px', color: 'inherit', fontWeight: on ? 600 : 400, borderBottom: on ? '2px solid currentColor' : '2px solid transparent', marginBottom: -1, textDecoration: 'none' }}>
            {String(label)}
          </Link>
        ))}
      </Box>
      {!onDefinition && (
        <>
          <Kpis
            items={[
              { label: t('native.api.operations'), value: type === 'openapi' ? ops.length : '—' },
              { label: t('native.api.withoutAuth'), value: type === 'openapi' ? open : '—', tone: open ? 'bad' : undefined },
              { label: t('native.api.providedBy'), value: providers.length },
              { label: t('native.api.consumedBy'), value: consumers.length },
            ]}
          />
          <Row spans={[7, 5]}>
            <Section title={t('native.about')}>
              <Facts
                items={[
                  [t('native.owner'), owner ? <RefLink refStr={`group:default/${owner}`} label={owner} /> : '—'],
                  [t('native.system'), system ? <RefLink refStr={`system:default/${system}`} label={system} /> : '—'],
                  [t('native.type'), type || '—'],
                  [t('native.lifecycle'), String(entity.spec?.lifecycle ?? '—')],
                  [t('native.providedBy'), providers.length ? providers.map(r => <Box key={r} component="span" sx={{ mr: 1 }}><RefLink refStr={r} /></Box>) : '—'],
                  [t('native.tags'), (entity.metadata.tags ?? []).length ? (entity.metadata.tags ?? []).map(tag => <Box key={tag} component="span" sx={{ mr: 0.75 }}><Pill plain>{tag}</Pill></Box>) : '—'],
                ]}
              />
            </Section>
            <Section title={t('native.api.whoUses')} meta={t('native.count', { n: consumers.length })} flush>
              {users && users.length ? <EntityTable items={users} compact /> : <EmptyState title={t('native.api.noConsumers')} />}
            </Section>
          </Row>
          {type === 'openapi' && ops.length > 0 && (
            <Section title={t('native.api.operations')} meta={t('native.count', { n: ops.length })} flush>
              <OperationsTable ops={ops.slice(0, 12)} />
              {ops.length > 12 && (
                <Box sx={{ px: 2.25, py: 1.25 }}>
                  <Link to={`${base}/definition`}>{t('native.api.allOps', { n: ops.length })}</Link>
                </Box>
              )}
            </Section>
          )}
        </>
      )}
      {onDefinition && (
        <>
          {!apiDefinition && type === 'openapi' && ops.length > 0 && (
            <Section title={t('native.api.operations')} meta={t('native.count', { n: ops.length })} flush>
              <OperationsTable ops={ops} />
            </Section>
          )}
          {apiDefinition ? (
            <Section title={t('native.definition')} meta={t('native.api.tryIt')} flush>
              <Box sx={{ px: 2.25, pb: 2 }}>
                <EntityProvider entity={entity}>
                  <ClassicFrame entity>{apiDefinition}</ClassicFrame>
                </EntityProvider>
              </Box>
            </Section>
          ) : (
          <Section title={t('native.definition')} meta={type} flush>
            {definition ? (
              <Box component="pre" sx={{ m: 0, p: 2.25, fontFamily: MONO, fontSize: 12.5, lineHeight: '19px', maxHeight: 640, overflow: 'auto', bgcolor: 'action.hover' }}>
                {definition}
              </Box>
            ) : (
              <EmptyState title={t('native.api.noDefinition')} />
            )}
          </Section>
          )}
        </>
      )}
    </>
  );
};

/* ---------------- Group ---------------- */

const GroupPage = ({ entity }: { entity: Entity }) => {
  const { t } = useI18n();
  const members = related(entity, 'hasMember');
  const owned = useEntities(related(entity, 'ownerOf'));
  const parent = related(entity, 'childOf')[0];
  const children = related(entity, 'parentOf');
  const byKind = useMemo(() => {
    const m = new Map<string, Entity[]>();
    for (const e of owned ?? []) {
      const what = classify(e);
      let k = `${e.kind}${e.spec?.type ? ` · ${String(e.spec.type)}` : ''}`;
      if (what === 'business') k = e.kind === 'System' ? t('native.bs.many') : t('cat.businessApps');
      else if (what === 'development') k = t('cat.development');
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [owned, t]);
  const profile = (entity.spec?.profile ?? {}) as { displayName?: string; email?: string };
  return (
    <>
      <TitleRow
        crumbs={[[t('nav.portal'), '/console'], [t('nav.resolutionGroups'), '/console/resolution-groups'], [entity.metadata.name]]}
        title={profile.displayName ?? titleOf(entity)}
        pills={<Pill plain>{t('native.group')}</Pill>}
        sub={entity.metadata.description}
        finding={members.length ? undefined : t('native.group.noMembers')}
      />
      <Kpis
        items={[
          { label: t('native.group.members'), value: members.length, tone: members.length ? undefined : 'bad' },
          { label: t('native.group.owns'), value: owned ? owned.length : '…' },
          { label: t('native.group.kinds'), value: byKind.length },
          { label: t('native.group.children'), value: children.length },
        ]}
      />
      <Row spans={[5, 7]}>
        <Section title={t('native.about')}>
          <Facts
            items={[
              [t('native.group.ref'), <Id key="ref">{stringifyEntityRef(entity)}</Id>],
              [t('native.group.parent'), parent ? <RefLink refStr={parent} /> : '—'],
              [t('native.group.children'), children.length ? children.map(c => <Box key={c} component="span" sx={{ mr: 1 }}><RefLink refStr={c} /></Box>) : '—'],
              [t('native.group.email'), profile.email ?? '—'],
            ]}
          />
        </Section>
        <Section title={t('native.group.members')} meta={t('native.count', { n: members.length })}>
          {members.length ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {members.map(m => (
                <Pill key={m} plain>
                  {parseEntityRef(m).name}
                </Pill>
              ))}
            </Box>
          ) : (
            <EmptyState title={t('native.group.noMembers')} />
          )}
        </Section>
      </Row>
      {byKind.map(([k, items]) => (
        <Section key={k} title={k} meta={t('native.count', { n: items.length })} flush>
          <EntityTable items={items} />
        </Section>
      ))}
      {owned && !owned.length && (
        <Section>
          <EmptyState title={t('native.group.nothing')} />
        </Section>
      )}
    </>
  );
};

/* ---------------- System ---------------- */

/** The instances of a business service, pro first: stage, instance and the platform blocks it declares. */
const InstanceTable = ({ instances }: { instances: Instance[] }) => {
  const { t } = useI18n();
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{t('native.bs.stage')}</TableCell>
          <TableCell>{t('native.bs.instance')}</TableCell>
          <TableCell>{t('native.bs.blocks')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {instances.map(i => (
          <TableRow key={stringifyEntityRef(i.entity)} hover>
            <TableCell>
              <Pill tone={i.stage === 'pro' ? 'pos' : 'neu'} plain>
                {i.stage}
              </Pill>
            </TableCell>
            <TableCell>
              <Link to={consoleRefPath(stringifyEntityRef(i.entity))} style={{ fontWeight: 500 }}>
                {titleOf(i.entity)}
              </Link>
              <Typography variant="caption" color="text.secondary" component="div">
                {String(i.entity.spec?.lifecycle ?? '')}
              </Typography>
            </TableCell>
            <TableCell>
              {i.blocks.length
                ? i.blocks.map(b => (
                    <Box key={stringifyEntityRef(b)} component="span" sx={{ mr: 0.75, display: 'inline-block', mb: 0.5 }}>
                      <Link to={consoleRefPath(stringifyEntityRef(b))}>
                        <Pill plain>{b.metadata.annotations?.['refresquito.io/platform-block'] ?? titleOf(b)}</Pill>
                      </Link>
                    </Box>
                  ))
                : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const SystemPage = ({ entity }: { entity: Entity }) => {
  const { t } = useI18n();
  const parts = useEntities(related(entity, 'hasPart'));
  const owner = refName(String(entity.spec?.owner ?? ''));
  const domain = entity.spec?.domain ? String(entity.spec.domain) : undefined;
  const of = (kind: string) => (parts ?? []).filter(e => e.kind.toLowerCase() === kind);
  const comps = of('component');
  const biz = comps.filter(e => classify(e) === 'business');
  const view = useMemo(() => businessServiceView(parts ?? []), [parts]);
  const business = isBusinessService(entity, view);
  // a business service lists its application and instances apart; the tables below keep the rest of its parts
  const rest = (kind: string) => (business ? view.others.filter(e => e.kind.toLowerCase() === kind) : of(kind));
  return (
    <>
      <TitleRow
        crumbs={[[t('nav.portal'), '/console'], [t('native.system'), '/console'], [titleOf(entity)]]}
        title={titleOf(entity)}
        pills={<Pill plain tone={business ? 'pos' : undefined}>{business ? t('native.bs.pill') : t('native.system')}</Pill>}
        sub={entity.metadata.description}
      />
      <Kpis
        items={
          business
            ? [
                { label: t('native.bs.application'), value: parts ? view.applications.length : '…' },
                { label: t('native.bs.instances'), value: parts ? view.instances.length : '…', note: view.instances.map(i => i.stage).join(' · ') || undefined },
                { label: t('native.bs.blocks'), value: parts ? view.instances.reduce((n, i) => n + i.blocks.length, 0) : '…' },
                { label: 'APIs', value: parts ? of('api').length : '…' },
              ]
            : [
                { label: t('native.system.components'), value: parts ? comps.length : '…', note: parts ? t('native.system.business', { n: biz.length }) : undefined },
                { label: 'APIs', value: parts ? of('api').length : '…' },
                { label: t('native.system.resources'), value: parts ? of('resource').length : '…' },
              ]
        }
      />
      <Section title={t('native.about')}>
        <Facts
          items={[
            [t('native.owner'), owner ? <RefLink refStr={`group:default/${owner}`} label={owner} /> : '—'],
            [t('native.system.domain'), domain ? <RefLink refStr={`domain:default/${domain}`} label={domain} /> : '—'],
            [t('page.costs'), <Link key="costs" to="/console/costs">{t('native.system.costs')}</Link>],
          ]}
        />
      </Section>
      {business && parts && (
        <>
          <Section title={t('native.bs.application')} meta={t('native.count', { n: view.applications.length })} flush>
            {view.applications.length ? <EntityTable items={view.applications} /> : <EmptyState title={t('native.bs.noApplication')} />}
          </Section>
          <Section title={t('native.bs.instances')} meta={t('native.count', { n: view.instances.length })} flush>
            {view.instances.length ? <InstanceTable instances={view.instances} /> : <EmptyState title={t('native.bs.noInstances')} />}
          </Section>
        </>
      )}
      {[
        ['component', t('native.system.components')],
        ['api', 'APIs'],
        ['resource', t('native.system.resources')],
      ].map(([kind, title]) =>
        rest(kind).length ? (
          <Section key={kind} title={title} meta={t('native.count', { n: rest(kind).length })} flush>
            <EntityTable items={rest(kind)} />
          </Section>
        ) : null,
      )}
    </>
  );
};

/** The native page of an API, group or system. */
export const NativeEntityPage = ({ entity, apiDefinition }: { entity: Entity; apiDefinition?: ReactNode }) => {
  switch (entity.kind.toLowerCase()) {
    case 'api':
      return <ApiPage entity={entity} apiDefinition={apiDefinition} />;
    case 'group':
      return <GroupPage entity={entity} />;
    default:
      return <SystemPage entity={entity} />;
  }
};
