import { embedUrl } from './AppFrame';

describe('embedUrl', () => {
  it('adds the console mode for the shell of the application', () => {
    expect(embedUrl('https://support.example.org', 'dark')).toBe('https://support.example.org/?rq-embed=1&rq-theme=dark');
  });
  it('keeps the path and the parameters the application already has', () => {
    expect(embedUrl('https://ps.example.org/app?x=1', 'light')).toBe('https://ps.example.org/app?x=1&rq-embed=1&rq-theme=light');
  });
});
