import OpenInNew from '@mui/icons-material/OpenInNew';
import type { PropsWithChildren } from 'react';
import { classicUrl, useConsoleConfig } from '../config';
import { rq } from './tokens';

/** A link to a page of the classic portal (explicit colour: plain links inherit the text colour in this app). */
export const ClassicLink = ({ path, children }: PropsWithChildren<{ path: string }>) => {
  const cfg = useConsoleConfig();
  return (
    <a
      href={classicUrl(cfg, path)}
      style={{ color: rq.primary, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
    >
      {children ?? 'Open in the classic portal'}
      <OpenInNew style={{ fontSize: 14 }} />
    </a>
  );
};
