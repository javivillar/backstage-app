import { Link, Progress } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { PropsWithChildren } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';
import { areaOfPath, usePortalPermissions, type Access, type AreaAccess } from '../portalPermissions';
import { useRq } from '../theme/consoleTheme';
import { EmptyState, Id, Pill, Section, TitleRow, type Tone } from './ui';

const TONE: Record<Access, Tone> = { manage: 'pos', read: 'info', hidden: 'neu' };

const Groups = ({ groups }: { groups: string[] }) => (
  <Box component="span" sx={{ display: 'inline-flex', gap: '4px 10px', flexWrap: 'wrap' }}>
    {groups.map(g => (
      <Id key={g}>{g}</Id>
    ))}
  </Box>
);

/**
 * Portal › Manage › Roles and permissions: the one table of permissions of the portal (backend portalPermissions.ts)
 * as the signed-in person stands in it: who manages and who sees each area, and their own access. Read only: who has
 * a role is changed in Access administration (a role is a Keycloak group).
 */
export const RolesPermissionsPage = () => {
  const { t } = useI18n();
  const rq = useRq();
  const { loading, permissions, error, access } = usePortalPermissions();
  const crumbs: Array<[string, string?]> = [['Portal', '/console'], [t('nav.manage'), '/console/manage'], [t('perm.title')]];
  if (loading) return <Progress />;
  if (!permissions) {
    return (
      <>
        <TitleRow crumbs={crumbs} title={t('perm.title')} />
        <EmptyState tone="neg" title={t('perm.error')}>
          {error}
        </EmptyState>
      </>
    );
  }
  const admins = permissions.admins;
  const who = (a: AreaAccess) => [...a.manage, ...admins];
  const sees = (a: AreaAccess) => {
    if (a.view === 'all') return t('perm.everyone');
    if (!a.view.length) return t('perm.onlyManagers');
    return <Groups groups={a.view} />;
  };
  return (
    <>
      <TitleRow
        crumbs={crumbs}
        title={t('perm.title')}
        sub={t('perm.sub')}
        actions={
          access('access') !== 'hidden' && (
            <Button variant="outlined" component={Link} to="/console/access-administration">
              {t('perm.change')}
            </Button>
          )
        }
      />
      <Section title={t('perm.yours')}>
        {permissions.roles.length ? (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {permissions.roles.map(r => (
              <Pill key={r} tone="info" plain>
                {t(`perm.role.${r}`)}
              </Pill>
            ))}
          </Box>
        ) : (
          <Typography color="text.secondary">{t('perm.yours.none')}</Typography>
        )}
      </Section>
      <Section title={t('perm.areas')} flush>
        <Box component="table" sx={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', '& th': { textAlign: 'left', fontWeight: 500, fontSize: 12, color: 'text.secondary', px: 2.25, pb: 1 }, '& td': { px: 2.25, py: 1.25, borderTop: `1px solid ${rq.rule}`, verticalAlign: 'top' } }}>
          <thead>
            <tr>
              <th>{t('perm.col.area')}</th>
              <th>{t('perm.col.manage')}</th>
              <th>{t('perm.col.view')}</th>
              <th>{t('perm.col.yours')}</th>
            </tr>
          </thead>
          <tbody>
            {permissions.areas.map(a => (
              <tr key={a.id}>
                <td>
                  <Box component="b" sx={{ fontWeight: 500, display: 'block' }}>
                    {t(`perm.area.${a.id}`)}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {t(`perm.area.${a.id}.note`)}
                  </Typography>
                </td>
                <td>
                  <Groups groups={who(a)} />
                  {a.scope && a.manage.length > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {t(`perm.scope.${a.scope}`)}
                    </Typography>
                  )}
                </td>
                <td>{sees(a)}</td>
                <td>
                  <Pill tone={TONE[a.access]} plain>
                    {t(`perm.access.${a.access}`)}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </Box>
      </Section>
    </>
  );
};

/**
 * Shows the page of a route only to who may use its area; otherwise says which role it needs and who gives it. The
 * menu already leaves the entry out: this is for a link opened directly. The backend refuses on its own.
 */
export const AreaGuard = ({ children }: PropsWithChildren) => {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { permissions, access } = usePortalPermissions();
  const id = areaOfPath(pathname);
  if (!id || !permissions || access(id) !== 'hidden') return <>{children}</>;
  const area = permissions.areas.find(a => a.id === id);
  const needs = [...new Set([...(area?.manage ?? []), ...(area && area.view !== 'all' ? area.view : [])])];
  const name = t(`perm.area.${id}`);
  return (
    <>
      <TitleRow title={t('perm.denied.title', { area: name })} />
      <EmptyState
        title={needs.length ? t('perm.denied.needs', { groups: needs.join(', ') }) : t('perm.denied.adminOnly')}
        action={
          <Button variant="outlined" component={Link} to="/console/roles-permissions">
            {t('perm.denied.see')}
          </Button>
        }
      >
        {t('perm.denied.ask', { admins: permissions.admins.join(', ') })}
      </EmptyState>
    </>
  );
};
