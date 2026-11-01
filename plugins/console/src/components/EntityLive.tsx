import { useEntity } from '@backstage/plugin-catalog-react';
import Typography from '@mui/material/Typography';
import { NAMESPACE_ANNOTATION } from './EntityNetwork';
import { NamespaceLiveSections } from './NamespaceSections';

export type { NamespaceLive, PodLive } from '../namespace';

/** Entity tab (console only): what runs in its namespace now, read again every 30 s. */
export const EntityLiveContent = () => {
  const { entity } = useEntity();
  const ns = entity.metadata.annotations?.[NAMESPACE_ANNOTATION];
  if (!ns) return <Typography color="text.secondary">This entity does not say its namespace (annotation {NAMESPACE_ANNOTATION}).</Typography>;
  return <NamespaceLiveSections namespace={ns} />;
};
