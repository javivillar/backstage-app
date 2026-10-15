import { InfoCard, Link, Progress, WarningPanel } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { ago, REPOSITORY_ANNOTATION, SLUG_ANNOTATION, useGithub } from './useGithub';

type Run = {
  id: number;
  name: string;
  display_title: string;
  head_branch: string;
  head_sha: string;
  event: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  run_started_at?: string;
  updated_at: string;
};

const COLOR: Record<string, string> = { success: '#2e7d32', failure: '#c62828', cancelled: '#757575', skipped: '#757575' };
const cell = { padding: '6px 10px', textAlign: 'left' as const, verticalAlign: 'top' as const };
const head = { ...cell, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, opacity: 0.65 };

const duration = (r: Run) => {
  const s = (new Date(r.updated_at).getTime() - new Date(r.run_started_at ?? r.created_at).getTime()) / 1000;
  return s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
};

/**
 * The last runs of GitHub Actions of a repository: its CI (tests, and the images it publishes).
 * The repository is the one of the entity (github.com/project-slug), or, on the deployment of an
 * application, the one of the application (refresquito.io/repository).
 */
export const EntityGithubRunsCard = ({ title }: { title?: string }) => {
  const { entity } = useEntity();
  const slug = entity.metadata.annotations?.[SLUG_ANNOTATION] ?? entity.metadata.annotations?.[REPOSITORY_ANNOTATION];
  const { value, loading, error } = useGithub<{ workflow_runs: Run[] }>(slug ? `/repos/${slug}/actions/runs?per_page=10` : undefined);
  let body;
  if (!slug) body = <div style={{ opacity: 0.75 }}>This entity names no GitHub repository.</div>;
  else if (loading) body = <Progress />;
  else if (error) body = <WarningPanel severity="warning" title="GitHub could not be read" message={error.message} />;
  else if (!value?.workflow_runs?.length) body = <div style={{ opacity: 0.75 }}>No runs of GitHub Actions in {slug} yet.</div>;
  else
    body = (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={head}>Result</th>
              <th style={head}>Workflow</th>
              <th style={head}>Commit</th>
              <th style={head}>Branch</th>
              <th style={head}>Started</th>
              <th style={head}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {value.workflow_runs.map(r => {
              const result = r.status === 'completed' ? r.conclusion ?? 'unknown' : r.status;
              return (
                <tr key={r.id} style={{ borderTop: '1px solid rgba(128,128,128,0.2)' }}>
                  <td style={{ ...cell, fontWeight: 700, color: COLOR[result] ?? '#1565c0' }}>
                    <Link to={r.html_url}>{result}</Link>
                  </td>
                  <td style={cell}>{r.name}</td>
                  <td style={cell}>
                    <code>{r.head_sha.slice(0, 7)}</code> {r.display_title}
                  </td>
                  <td style={cell}>{r.head_branch} <span style={{ opacity: 0.6 }}>({r.event})</span></td>
                  <td style={cell}>{ago(r.run_started_at ?? r.created_at)}</td>
                  <td style={cell}>{r.status === 'completed' ? duration(r) : '…'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  return (
    <InfoCard
      title={title ?? 'CI: GitHub Actions'}
      subheader={slug}
      deepLink={slug ? { title: 'All runs in GitHub', link: `https://github.com/${slug}/actions` } : undefined}
      variant="gridItem"
    >
      {body}
    </InfoCard>
  );
};
