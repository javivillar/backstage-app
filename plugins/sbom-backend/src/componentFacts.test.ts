import { componentFacts } from './techInsights';
import type { ImageScan } from './vulnerabilities';

const scan = (components: ImageScan['components']): ImageScan =>
  ({ digest: 'sha256:x', status: 'scanned', counts: {}, vulns: [], components }) as ImageScan;

describe('end of life of the runtimes and servers (wazuh-oneke 0.23.0)', () => {
  it('counts distinct releases out of support, ending soon and Go toolchains apart', () => {
    const f = componentFacts(
      [
        scan([
          { product: 'traefik', label: 'Traefik', version: '3.5.1', release: '3.5', status: 'eol', source: 'label' },
          { product: 'go', label: 'Go', version: '1.24.6', release: '1.24', status: 'eol', source: 'go' },
          { product: 'python', label: 'Python', version: '3.12.15', release: '3.12', status: 'supported', source: 'env' },
        ]),
        scan([
          { product: 'traefik', label: 'Traefik', version: '3.5.0', release: '3.5', status: 'eol', source: 'image' },
          { product: 'nodejs', label: 'Node.js', version: '20.19.0', release: '20', status: 'soon', source: 'env' },
        ]),
      ],
      2,
    );
    expect(f).toEqual({
      componentsEndOfLife: 1,
      componentsEndingSoon: 1,
      toolchainsEndOfLife: 1,
      componentsOutOfSupport: 'Traefik 3.5',
    });
  });

  it('is unknown (-1) when an image is not scanned or its scan does not list components', () => {
    expect(componentFacts([scan([])], 2).componentsEndOfLife).toBe(-1);
    expect(componentFacts([scan(null), scan([])], 2).componentsEndOfLife).toBe(-1);
    expect(componentFacts([scan([]), scan([])], 2)).toMatchObject({ componentsEndOfLife: 0, toolchainsEndOfLife: 0 });
  });
});
