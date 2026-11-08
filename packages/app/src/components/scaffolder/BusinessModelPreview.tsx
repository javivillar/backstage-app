import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { createScaffolderFieldExtension, type FieldExtensionComponentProps, scaffolderPlugin } from '@backstage/plugin-scaffolder';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import {
  blockingMessage,
  cardsOf,
  type Change,
  issueText,
  type Preview,
  previewKey,
  previewRequest,
  type PreviewValue,
  shownChanges,
  valueOf,
} from './businessModelPreviewModel';

/**
 * The form field BusinessModelPreview (ui:field of the template Import business model): the preview of the import in
 * the form, as step 3 of the mockup (Business map board Import): the counts, the errors that stop it, the warnings and
 * the changes. Its validation blocks Next while the file has errors, unless "Skip the rows with errors" is ticked.
 */

type Answer = { preview?: Preview; error?: string };

const KIND_CHIP: Record<Change['kind'], { label: string; color: 'success' | 'default' | 'warning' }> = {
  new: { label: 'new', color: 'success' },
  changed: { label: 'changed', color: 'default' },
  review: { label: 'review', color: 'warning' },
};

const PreviewDetails = ({ preview, namespace, skipErrors }: { preview: Preview; namespace: string; skipErrors: boolean }) => {
  const { rows, total } = shownChanges(preview.changes);
  const errors = preview.errors.length;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="h6" component="h3">
        What the pull request will change in {namespace}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 1.25 }}>
        {cardsOf(preview.counts).map(c => (
          <Box key={c.label} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, px: 1.75, py: 1.25 }}>
            <Typography sx={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: c.tone === 'positive' ? 'success.main' : 'text.primary' }}>
              {c.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {c.label}
            </Typography>
          </Box>
        ))}
      </Box>
      {errors > 0 && (
        <Alert severity={skipErrors ? 'info' : 'warning'} role="status">
          <b>{`${errors} ${errors === 1 ? 'error stops' : 'errors stop'} the import.`}</b> {skipErrors ? 'Those rows are skipped: the rest is imported and the pull request lists them.' : 'Fix them in the file and upload it again, or skip those rows below.'}
        </Alert>
      )}
      {errors + preview.warnings.length > 0 && (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {preview.errors.map((i, n) => (
            <Box component="li" key={`e${n}`} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.25, py: 1 }}>
              <Chip size="small" color="error" label="error" />
              <Typography variant="body2">{issueText(i)}</Typography>
            </Box>
          ))}
          {preview.warnings.map((i, n) => (
            <Box component="li" key={`w${n}`} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.25, py: 1 }}>
              <Chip size="small" color="warning" label="warning" />
              <Typography variant="body2">{issueText(i)}</Typography>
            </Box>
          ))}
        </Box>
      )}
      {total > 0 ? (
        <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 2 }}>
          <Table size="small" aria-label="Changes of the import">
            <caption style={{ captionSide: 'top', textAlign: 'left', fontWeight: 600 }}>
              Changes{total > rows.length ? `, first ${rows.length} of ${total}` : ` (${total})`}
            </caption>
            <TableHead>
              <TableRow>
                <TableCell>Change</TableCell>
                <TableCell>ID</TableCell>
                <TableCell>Process</TableCell>
                <TableCell>What</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(c => (
                <TableRow key={`${c.kind}-${c.id}`}>
                  <TableCell>
                    <Chip size="small" color={KIND_CHIP[c.kind].color} label={KIND_CHIP[c.kind].label} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{c.id}</TableCell>
                  <TableCell>{c.title}</TableCell>
                  <TableCell>{c.what}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Nothing changes: the business map of {namespace} already is what the file says.
        </Typography>
      )}
    </Box>
  );
};

export const BusinessModelPreviewField = ({ formContext, onChange }: FieldExtensionComponentProps<PreviewValue>) => {
  const discovery = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const form = formContext?.formData as Record<string, unknown> | undefined;
  const { body, missing } = useMemo(() => previewRequest(form), [form]);
  const key = body ? previewKey(body) : '';
  const [answer, setAnswer] = useState<Answer | undefined>(undefined);

  // the effect runs again only when the input of the preview changes (key), with the latest body and onChange
  const latest = useRef({ body, onChange });
  latest.current = { body, onChange };

  useEffect(() => {
    const b = latest.current.body;
    const report = (v: PreviewValue | undefined) => latest.current.onChange(v);
    setAnswer(undefined);
    if (!b) {
      report({ state: 'failed', key: '', message: 'missing values' });
      return undefined;
    }
    let alive = true;
    report({ state: 'loading', key });
    (async () => {
      let a: Answer;
      try {
        const base = await discovery.getBaseUrl('business-map');
        const res = await fetchApi.fetch(`${base}/import/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
        const json = (await res.json().catch(() => ({}))) as Preview & { error?: string };
        a = res.ok ? { preview: json } : { error: json.error ?? `${res.status} ${res.statusText}` };
      } catch (e) {
        a = { error: (e as Error).message };
      }
      if (!alive) return;
      setAnswer(a);
      report(valueOf(key, a));
    })();
    return () => {
      alive = false;
    };
  }, [key, discovery, fetchApi]);

  const namespace = typeof form?.namespace === 'string' ? form.namespace : '';
  let content: ReactNode;
  if (!body) content = <Alert severity="info">The preview needs {missing}: fill them in on the first page.</Alert>;
  else if (!answer) {
    content = (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Reading the file and comparing it with the business map of {namespace}…
        </Typography>
        <LinearProgress />
      </Box>
    );
  } else if (!answer.preview) content = <Alert severity="error">The preview failed: {answer.error}. Go back and fix the file or the options.</Alert>;
  else content = <PreviewDetails preview={answer.preview} namespace={namespace} skipErrors={form?.skipErrors === true} />;

  // the errors of the validation (blockingMessage) are shown under the field by the form itself
  return <Box sx={{ mb: 1 }}>{content}</Box>;
};

/** Registered in App.tsx inside <ScaffolderPage>: <ScaffolderFieldExtensions><BusinessModelPreviewFieldExtension /></...>. */
export const BusinessModelPreviewFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'BusinessModelPreview',
    component: BusinessModelPreviewField,
    validation: (value: PreviewValue, validation, context) => {
      const m = blockingMessage(value, context.formData);
      if (m) validation.addError(m);
    },
  }),
);
