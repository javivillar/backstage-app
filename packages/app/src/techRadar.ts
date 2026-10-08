import { ConfigApi } from '@backstage/core-plugin-api';
import {
  TechRadarApi,
  TechRadarLoaderResponse,
} from '@backstage-community/plugin-tech-radar';

const DEFAULT_RINGS = [
  { id: 'adopt', name: 'ADOPT', color: '#5BA300' },
  { id: 'trial', name: 'TRIAL', color: '#009EB0' },
  { id: 'assess', name: 'ASSESS', color: '#C7BA00' },
  { id: 'hold', name: 'HOLD', color: '#E09B96' },
];

/**
 * Tech Radar read from app-config (`techRadar`), so each deployment publishes its own radar
 * without rebuilding the app. Each entry says where it stands today (`ring`, `date`); the
 * plugin's timeline is built from that. Without config the radar is empty.
 */
export class ConfigTechRadarApi implements TechRadarApi {
  constructor(private readonly configApi: ConfigApi) {}

  async load(): Promise<TechRadarLoaderResponse> {
    const radar = this.configApi.getOptionalConfig('techRadar');
    const rings =
      radar?.getOptionalConfigArray('rings')?.map(r => ({
        id: r.getString('id'),
        name: r.getString('name'),
        color: r.getString('color'),
        description: r.getOptionalString('description'),
      })) ?? DEFAULT_RINGS;
    const quadrants =
      radar?.getOptionalConfigArray('quadrants')?.map(q => ({
        id: q.getString('id'),
        name: q.getString('name'),
      })) ?? [];
    const entries =
      radar?.getOptionalConfigArray('entries')?.map(e => {
        const url = e.getOptionalString('url');
        return {
          key: e.getString('id'),
          id: e.getString('id'),
          title: e.getString('title'),
          quadrant: e.getString('quadrant'),
          description: e.getOptionalString('description'),
          links: url ? [{ url, title: 'More information' }] : undefined,
          timeline: [
            {
              ringId: e.getString('ring'),
              date: new Date(e.getOptionalString('date') ?? Date.now()),
              description: e.getOptionalString('description'),
            },
          ],
        };
      }) ?? [];
    return { quadrants, rings, entries };
  }
}
