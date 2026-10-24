import logo from './refresquito-logo.png';

/**
 * The sidebar logo, open: Refresquito with white text on a transparent background (made from
 * refresquito-logo-dark.png without its navy background), readable on the blue sidebar of the light theme and the
 * near-black one of the dark theme.
 */
export const LogoFull = () => (
  <img src={logo} alt="Refresquito Platform" style={{ width: 190, height: 'auto', display: 'block' }} />
);
