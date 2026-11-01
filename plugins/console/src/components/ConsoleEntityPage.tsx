import type { Entity } from '@backstage/catalog-model';
import { Link, Progress } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { AsyncEntityProvider, catalogApiRef } from '@backstage/plugin-catalog-react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { classicUrl, useConsoleConfig } from '../config';
import { ClassicFrame } from './ClassicFrame';
import { ServiceDataProvider } from './ServiceData';
import { ServiceHeader } from './ServiceViews';
import { classify, entityPath } from './classify';

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


/**
 * /console/entity/:namespace/:kind/:name/*: the classic entity page (tabs and cards, passed in by the app) under the
 * header of the console. Links to pages the console also shows stay inside the console.
 */
export const ConsoleEntityPage = ({ content }: { content?: ReactNode }) => {
  const cfg = useConsoleConfig();
  const { loading, entity, error, refresh } = useEntityFromRoute();
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {loading && <Progress />}
      {entity && (
        <Typography variant="body2" color="text.secondary">
          <Link to="/console">Portal</Link> / {classify(entity) === 'business' ? 'Business applications' : entity.kind} / {entity.metadata.title ?? entity.metadata.name}
        </Typography>
      )}
      {!content && entity && (
        <Typography color="text.secondary">
          This portal does not pass the entity cards to the console:{' '}
          <a href={classicUrl(cfg, entityPath(entity))}>open the classic page</a>.
        </Typography>
      )}
      {content && !loading && entity && (
        <ServiceDataProvider entity={entity}>
          <ServiceHeader />
          <ClassicFrame entity>
          <AsyncEntityProvider loading={loading} entity={entity} error={error} refresh={refresh}>
            {content}
          </AsyncEntityProvider>
          </ClassicFrame>
        </ServiceDataProvider>
      )}
      {!entity && error && <Typography color="error">{error.message}</Typography>}
    </Box>
  );
};
