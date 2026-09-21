import { useEffect, useState } from 'react';
import { Content, Header, Page, Progress } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { SearchResult, TYPE_LABEL, useCapabilities, useDatahubFetch } from '../api';
import { ClassificationChip, OwnerChips, ScoreBar } from './parts';

const PAGE = 25;

// The scaffolder is mounted at /create; each template is /create/templates/<namespace>/<name>.
const template = (name: string) => `/create/templates/default/${name}`;

/**
 * The actions of this plugin live in the software templates: this bar puts them where people look for them.
 * Templates that CREATE things in DataHub only show for users whose group allows it (GET /capabilities).
 */
function ActionsBar() {
  const caps = useCapabilities();
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {caps?.canCreate && (
          <>
            <Button variant="contained" href={template('datahub-new-data-product')}>
              New data product
            </Button>
            <Button variant="outlined" href={template('datahub-register-asset')}>
              Add assets to a product
            </Button>
            <Button variant="outlined" href={template('datahub-deprecate-asset')}>
              Deprecate an asset
            </Button>
          </>
        )}
        <Button variant="outlined" href={template('datahub-check-impact')}>
          Check impact of a change
        </Button>
        <Button variant="outlined" href={template('datahub-request-vocabulary')}>
          Request vocabulary
        </Button>
      </Box>
      {caps && !caps.canCreate && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {caps.writesEnabled
            ? 'Creating data products needs the datahub-editor group. You can read, check impact and request vocabulary.'
            : 'Creating data products is switched off. You can read, check impact and request vocabulary.'}
        </Typography>
      )}
    </Box>
  );
}

/**
 * /datahub — read-only search over the DataHub catalog with the governance
 * completeness of each asset, and a "gaps only" filter. Editing happens in
 * DataHub (phase 1 of BACKSTAGE-DATAHUB-DESIGN.md).
 */
export function DatahubCatalogPage() {
  const get = useDatahubFetch();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [gaps, setGaps] = useState(false);
  const [start, setStart] = useState(0);
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: SearchResult }>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: undefined }));
    const params = new URLSearchParams({ query, start: String(start), count: String(PAGE) });
    if (type) params.set('type', type);
    if (gaps) params.set('gaps', 'true');
    get<SearchResult>(`/search?${params}`)
      .then(data => !cancelled && setState({ loading: false, data }))
      .catch(e => !cancelled && setState({ loading: false, error: (e as Error).message }));
    return () => {
      cancelled = true;
    };
  }, [get, query, type, gaps, start]);

  const { loading, error, data } = state;
  return (
    <Page themeId="tool">
      <Header title="DataHub" subtitle="Data assets and their governance completeness (read-only)" />
      <Content>
        <ActionsBar />
        <Box
          component="form"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            setStart(0);
            setQuery(text);
          }}
          sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}
        >
          <TextField size="small" label="Search assets" value={text} onChange={e => setText(e.target.value)} sx={{ minWidth: 280 }} />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="dh-type">Type</InputLabel>
            <Select
              labelId="dh-type"
              label="Type"
              value={type}
              onChange={e => {
                setStart(0);
                setType(e.target.value);
              }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="dataset">{TYPE_LABEL.dataset}</MenuItem>
              <MenuItem value="dataProduct">{TYPE_LABEL.dataProduct}</MenuItem>
              <MenuItem value="dataFlow">{TYPE_LABEL.dataFlow}</MenuItem>
            </Select>
          </FormControl>
          <FormControlLabel
            control={
              <Switch
                checked={gaps}
                onChange={e => {
                  setStart(0);
                  setGaps(e.target.checked);
                }}
              />
            }
            label="Governance gaps only"
          />
          <Button type="submit" variant="contained">
            Search
          </Button>
        </Box>

        {loading && <Progress />}
        {error && (
          <Typography color="error" sx={{ my: 2 }}>
            {error}
          </Typography>
        )}
        {data && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {data.total} asset{data.total === 1 ? '' : 's'} in DataHub
              {gaps ? ` · showing the ${data.items.length} below ${data.threshold}% on this page` : ''}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Domain</TableCell>
                  <TableCell>Classification</TableCell>
                  <TableCell>Owners</TableCell>
                  <TableCell>Completeness</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.items.map(a => (
                  <TableRow key={a.urn} hover>
                    <TableCell>
                      <Link href={a.url} target="_blank" rel="noopener">
                        {a.name}
                      </Link>
                      {a.platform && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {a.platform}
                        </Typography>
                      )}
                      {a.deprecated && <Chip size="small" color="warning" label="Deprecated" sx={{ ml: 1 }} />}
                    </TableCell>
                    <TableCell>{TYPE_LABEL[a.type]}</TableCell>
                    <TableCell>{a.domain?.name ?? '—'}</TableCell>
                    <TableCell>
                      <ClassificationChip value={a.classification} />
                    </TableCell>
                    <TableCell>
                      <OwnerChips owners={a.owners} />
                    </TableCell>
                    <TableCell>
                      <ScoreBar score={a.score} />
                    </TableCell>
                  </TableRow>
                ))}
                {data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>Nothing to show.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
              <Button disabled={start === 0} onClick={() => setStart(Math.max(0, start - PAGE))}>
                Previous
              </Button>
              <Button disabled={start + PAGE >= data.total} onClick={() => setStart(start + PAGE)}>
                Next
              </Button>
            </Box>
          </>
        )}
      </Content>
    </Page>
  );
}
