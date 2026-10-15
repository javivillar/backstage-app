import { InfoCard, Link, Progress, WarningPanel } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { ago, DEPLOYMENT_FILE_ANNOTATION, useGithub } from './useGithub';

type Commit = {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } };
};

const cell = { padding: '6px 10px', textAlign: 'left' as const, verticalAlign: 'top' as const };
const head = { ...cell, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, opacity: 0.65 };

/**
 * The changes merged to the file that deploys the entity (GitOps): each one is a deployment that Argo CD
 * then rolled out. refresquito.io/deployment-file is <owner>/<repo>:<path>.
 */
export const EntityDeploymentChangesCard = () => {
  const { entity } = useEntity();
  const ref = entity.metadata.annotations?.[DEPLOYMENT_FILE_ANNOTATION];
  const [repo, path] = ref ? ref.split(':', 2) : [undefined, undefined];
  const { value, loading, error } = useGithub<Commit[]>(
    repo && path ? `/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=10` : undefined,
  );
  let body;
  if (!repo || !path) body = <div style={{ opacity: 0.75 }}>This entity names no deployment file.</div>;
  else if (loading) body = <Progress />;
  else if (error) body = <WarningPanel severity="warning" title="GitHub could not be read" message={error.message} />;
  else if (!value?.length) body = <div style={{ opacity: 0.75 }}>No changes to {path} yet.</div>;
  else
    body = (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={head}>Change</th>
              <th style={head}>Pull request</th>
              <th style={head}>By</th>
              <th style={head}>Merged</th>
            </tr>
          </thead>
          <tbody>
            {value.map(c => {
              const first = c.commit.message.split('\n')[0];
              const pr = first.match(/\(#(\d+)\)\s*$/)?.[1];
              return (
                <tr key={c.sha} style={{ borderTop: '1px solid rgba(128,128,128,0.2)' }}>
                  <td style={cell}>
                    <Link to={c.html_url}><code>{c.sha.slice(0, 7)}</code></Link> {first.replace(/\s*\(#\d+\)\s*$/, '')}
                  </td>
                  <td style={cell}>{pr ? <Link to={`https://github.com/${repo}/pull/${pr}`}>#{pr}</Link> : '—'}</td>
                  <td style={cell}>{c.commit.author.name}</td>
                  <td style={cell}>{ago(c.commit.author.date)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  return (
    <InfoCard
      title="Deployments: changes to its deployment file"
      subheader={ref}
      deepLink={repo && path ? { title: 'History in GitHub', link: `https://github.com/${repo}/commits/main/${path}` } : undefined}
      variant="gridItem"
    >
      {body}
    </InfoCard>
  );
};
