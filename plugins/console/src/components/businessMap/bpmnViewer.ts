/**
 * The BPMN viewer (bpmn-js, served by Backstage from /vendor/bpmn-js, see packages/app/public/vendor/bpmn-js): loaded
 * once, the first time a model is drawn. It is not a dependency of the bundle: the pages that draw no model never
 * load it.
 */
export type BpmnElement = { id: string; type: string; x?: number; y?: number; businessObject?: { name?: string; flowNodeRef?: Array<{ id: string }> } };
export type BpmnViewer = {
  importXML(xml: string): Promise<{ warnings: unknown[] }>;
  get(name: 'canvas'): { zoom(level?: number | 'fit-viewport', center?: 'auto'): number; addMarker(id: string, cls: string): void; removeMarker(id: string, cls: string): void };
  get(name: 'elementRegistry'): { filter(fn: (e: BpmnElement) => boolean): BpmnElement[]; get(id: string): BpmnElement | undefined };
  get(name: 'eventBus'): { on(event: string, fn: (e: { element: BpmnElement }) => void): void };
  getDefinitions(): { rootElements?: Array<{ $type: string; name?: string; participants?: Array<{ name?: string }> }> };
  destroy(): void;
};
export type BpmnViewerClass = new (options: { container: HTMLElement }) => BpmnViewer;

export const BPMN_VIEWER_PATH = '/vendor/bpmn-js/bpmn-navigated-viewer.production.min.js';
let loading: Promise<BpmnViewerClass> | undefined;

/** The viewer class, loading its script from the application the first time. */
export function loadBpmnViewer(appBaseUrl: string): Promise<BpmnViewerClass> {
  const have = (window as unknown as { BpmnJS?: BpmnViewerClass }).BpmnJS;
  if (have) return Promise.resolve(have);
  if (!loading) {
    loading = new Promise<BpmnViewerClass>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${appBaseUrl.replace(/\/+$/, '')}${BPMN_VIEWER_PATH}`;
      s.async = true;
      s.onload = () => {
        const cls = (window as unknown as { BpmnJS?: BpmnViewerClass }).BpmnJS;
        if (cls) resolve(cls);
        else reject(new Error('the viewer script defines no viewer'));
      };
      s.onerror = () => {
        loading = undefined;
        reject(new Error(`${s.src} could not be loaded`));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** The name the file gives its process: that of its pool, else that of the process. */
export function nameInFile(viewer: BpmnViewer): string | undefined {
  const roots = viewer.getDefinitions().rootElements ?? [];
  const pool = roots.flatMap(r => r.participants ?? []).find(p => p.name);
  return pool?.name ?? roots.find(r => r.$type === 'bpmn:Process')?.name;
}
