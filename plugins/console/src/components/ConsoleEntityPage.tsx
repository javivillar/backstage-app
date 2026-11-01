import type { Entity } from '@backstage/catalog-model';
import { Link, Progress } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { AsyncEntityProvider, catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { classicUrl, useConsoleConfig } from '../config';
import { Badge } from './Badge';
import { ClassicFrame } from './ClassicFrame';
import { classify, entityPath } from './classify';
import { rq } from './tokens';

type State = { loading: boolean; entity?: Entity; error?: Error };

function useEntityFromRoute() {
  const { namespace = 'default', kind = '', name = '' } = useParams();
  const catalog = useApi(catalogApiRef);
  const [state, setState] = useState<State>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    catalog.getEntityByRef({ kind, namespace, name }).then(
      entity =>
        alive &&
        setState(entity ? { loading: false, entity } : { loading: false, error: new Error(`${kind}:${namespace}/${name} is not in the catalog`) }),
      error => alive && setState({ loading: false, error }),
    );
    return () => {
      alive = false;
    };
  }, [catalog, kind, namespace, name, tick]);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  return { ...state, refresh };
}

const Header = ({ entity }: { entity: Entity }) => {
  const cfg = useConsoleConfig();
  const kind = classify(entity);
  const owner = (entity.spec as { owner?: string } | undefined)?.owner;
  const system = (entity.spec as { system?: string } | undefined)?.system;
  const lifecycle = (entity.spec as { lifecycle?: string } | undefined)?.lifecycle;
  return (
    <Box sx={{ display: 'grid', gap: 0.75, mb: 1 }}>
      <Typography variant="body2" color="text.secondary">
        <Link to="/console">Portal</Link> / {entity.kind}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          {entity.metadata.title ?? entity.metadata.name}
        </Typography>
        {kind === 'business' && <Badge label="Business application" bg={rq.biz.bg} fg={rq.biz.fg} />}
        {kind === 'service' && <Badge label="Refresquito service" bg={rq.svc.bg} fg={rq.svc.fg} />}
        {lifecycle && <Badge outlined label={lifecycle} />}
      </Box>
      <Typography variant="body2" color="text.secondary">
        {[owner && `Owner ${owner}`, system && `System ${system}`].filter(Boolean).join(' · ')}
        {(owner || system) && ' · '}
        <a href={classicUrl(cfg, entityPath(entity))}>Open in the classic portal</a>
      </Typography>
    </Box>
  );
};

/**
 * /console/entity/:namespace/:kind/:name/*: the classic entity page (tabs and cards, passed in by the app) under the
 * header of the console. Links to pages the console also shows stay inside the console.
 */
export const ConsoleEntityPage = ({ content }: { content?: ReactNode }) => {
  const cfg = useConsoleConfig();
  const { loading, entity, error, refresh } = useEntityFromRoute();


  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {loading && <Progress />}
      {entity && <Header entity={entity} />}
      {!content && entity && (
        <Typography color="text.secondary">
          This portal does not pass the entity cards to the console:{' '}
          <a href={classicUrl(cfg, entityPath(entity))}>open the classic page</a>.
        </Typography>
      )}
      {content && !loading && (
        <ClassicFrame>
          <AsyncEntityProvider loading={loading} entity={entity} error={error} refresh={refresh}>
            {content}
          </AsyncEntityProvider>
        </ClassicFrame>
      )}
      {!content && error && <Typography color="error">{error.message}</Typography>}
    </Box>
  );
};
