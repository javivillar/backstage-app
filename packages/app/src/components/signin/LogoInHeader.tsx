import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import logo from '../logos/refresquito-logo.png';

/**
 * The sign-in page of Backstage takes only a text title for its header (app.title: "CNOE Backstage" before). Around
 * it, this puts the Refresquito logo (white text, for the blue header) in the heading of that header, whose own text
 * is hidden (font size 0: the logo keeps its size).
 */
export const LogoInHeader = ({ children }: { children: ReactNode }) => {
  const box = useRef<HTMLDivElement | null>(null);
  const [heading, setHeading] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => {
      const h = box.current?.querySelector<HTMLElement>('header h1') ?? null;
      if (h) h.style.fontSize = '0';
      return h;
    };
    const now = find();
    if (now) {
      setHeading(now);
      return undefined;
    }
    // the header can come after the first render
    const observer = new MutationObserver(() => {
      const h = find();
      if (h) {
        setHeading(h);
        observer.disconnect();
      }
    });
    if (box.current) observer.observe(box.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box}>
      {children}
      {heading &&
        createPortal(
          <img src={logo} alt="Refresquito Platform" style={{ height: 64, width: 'auto', display: 'block', margin: '0 auto' }} />,
          heading,
        )}
    </div>
  );
};
