import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback, useEffect, useState } from 'react';
import { stepStates, type TaskEvent } from './newAppModel';

/**
 * A template of the catalog run from a console page (no Scaffolder page): POST <scaffolder>/v2/tasks with its values,
 * then its steps and events as they go (the same calls as NewAppWizard). The template checks its parameters, its
 * groups and its steps on the server; the page only draws.
 */

export type TemplateTask = { id?: string; error?: string; starting?: boolean };
export type TaskLink = { title?: string; url?: string; entityRef?: string };
export type TaskProgress = {
  steps: Array<{ id: string; name: string }>;
  states: Map<string, string>;
  events: TaskEvent[];
  status: string;
  links: TaskLink[];
};

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/** Start a template (template:default/<name>) with values; task.id once it runs, task.error when it did not start. */
export function useTemplateTask(template: string) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [task, setTask] = useState<TemplateTask>({});
  const start = useCallback(
    async (values: Record<string, unknown>) => {
      setTask({ starting: true });
      try {
        const r = await fetch(`${await discovery.getBaseUrl('scaffolder')}/v2/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateRef: `template:default/${template}`, values }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error?.message ?? `${r.status} ${r.statusText}`);
        setTask({ id: body.id });
      } catch (e) {
        setTask({ error: (e as Error).message });
      }
    },
    [discovery, fetch, template],
  );
  const reset = useCallback(() => setTask({}), []);
  return { task, start, reset };
}

/** Follow a running task: its steps, the state of each, its log and, at the end, its status and output links. */
export function useTaskProgress(id: string | undefined): TaskProgress {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [steps, setSteps] = useState<Array<{ id: string; name: string }>>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [status, setStatus] = useState('processing');
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    setSteps([]);
    setEvents([]);
    setStatus('processing');
    (async () => {
      const base = `${await discovery.getBaseUrl('scaffolder')}/v2/tasks/${id}`;
      const t = await (await fetch(base)).json().catch(() => ({}));
      if (alive) setSteps((t?.spec?.steps ?? []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
      let after: number | undefined;
      while (alive) {
        const query = after === undefined ? '' : `?after=${after}`;
        const r = await fetch(`${base}/events${query}`).catch(() => undefined);
        const list: TaskEvent[] = r?.ok ? await r.json().catch(() => []) : [];
        if (list.length) {
          after = list[list.length - 1].id;
          const got = list;
          if (alive) setEvents(e => [...e, ...got]);
        }
        const done = list.find(e => e.type === 'completion');
        if (done) {
          if (alive) setStatus(done.body.status ?? 'completed');
          return;
        }
        await sleep(2000);
      }
    })();
    return () => {
      alive = false;
    };
  }, [discovery, fetch, id]);
  const output = events.find(e => e.type === 'completion')?.body.output as { links?: TaskLink[] } | undefined;
  return { steps, states: stepStates(events), events, status, links: output?.links ?? [] };
}
