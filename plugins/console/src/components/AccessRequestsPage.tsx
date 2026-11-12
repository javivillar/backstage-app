import { Progress } from '@backstage/core-components';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  askState,
  MAX_REASON,
  productTitle,
  useAccessRequests,
  useRequestActions,
  validReason,
  type AccessRequest,
  type AskableGroup,
  type RequestState,
} from '../accessAdmin';
import { useI18n } from '../i18n';
import { useRq } from '../theme/consoleTheme';
import { EmptyState, Id, Kpis, Pill, Section, TitleRow, type Tone } from './ui';

type Notice = { tone: 'pos' | 'neg'; text: string };

const STATE_TONE: Record<RequestState, Tone> = {
  pending: 'warn',
  approved: 'pos',
  rejected: 'neg',
  withdrawn: 'neu',
};
const who = (ref?: string) => (ref ?? '').replace(/^user:[^/]+\//, '');

/** A reason typed in place, with its two buttons: used to ask for a group and to reject a request. */
const ReasonForm = ({
  id,
  label,
  send,
  busy,
  onSend,
  onCancel,
}: {
  id: string;
  label: string;
  send: string;
  busy: boolean;
  onSend: (reason: string) => void;
  onCancel: () => void;
}) => {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        mt: 1,
      }}
    >
      <TextField
        id={id}
        label={label}
        size="small"
        multiline
        minRows={1}
        maxRows={4}
        value={reason}
        onChange={e => setReason(e.target.value)}
        inputProps={{ maxLength: MAX_REASON }}
        sx={{ flex: '1 1 320px', minWidth: 0 }}
      />
      <Button
        variant="contained"
        disabled={busy || !validReason(reason)}
        onClick={() => onSend(reason)}
      >
        {send}
      </Button>
      <Button disabled={busy} onClick={onCancel}>
        {t('req.cancel')}
      </Button>
    </Box>
  );
};

const Table = ({ head, children }: { head: string[]; children: ReactNode }) => {
  const rq = useRq();
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box
        component="table"
        sx={{
          width: '100%',
          minWidth: 640,
          borderCollapse: 'collapse',
          '& th': {
            textAlign: 'left',
            fontWeight: 500,
            fontSize: 12,
            color: 'text.secondary',
            px: 2.25,
            pb: 1,
          },
          '& td': {
            px: 2.25,
            py: 1.25,
            borderTop: `1px solid ${rq.rule}`,
            verticalAlign: 'top',
          },
        }}
      >
        <thead>
          <tr>
            {head.map(h => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </Box>
    </Box>
  );
};

/**
 * Portal › Administration › Access requests: a person asks to be put in a group of a product, with a reason; an administrator
 * of that product approves it (the person is added, as in Access administration) or rejects it with a reason. Who
 * administers a product also sees here the requests that wait for them. State in the URL: ?product=.
 */
export const AccessRequestsPage = () => {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const requests = useAccessRequests();
  const actions = useRequestActions();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [asking, setAsking] = useState<string>();
  const [rejecting, setRejecting] = useState<number>();
  const crumbs: Array<[string, string?]> = [
    ['Portal', '/console'],
    [t('nav.administration')],
    [t('req.title')],
  ];
  const when = (at?: string) => (at ? new Date(at).toLocaleString(lang) : '');

  const run = (work: Promise<unknown>, done: string) => {
    setBusy(true);
    setNotice(undefined);
    work
      .then(
        () => {
          setNotice({ tone: 'pos', text: done });
          setAsking(undefined);
          setRejecting(undefined);
          requests.reload();
        },
        e => setNotice({ tone: 'neg', text: (e as Error).message }),
      )
      .finally(() => setBusy(false));
  };

  if (requests.loading && !requests.data) return <Progress />;
  const data = requests.data;
  if (!data) {
    return (
      <>
        <TitleRow crumbs={crumbs} title={t('req.title')} />
        <EmptyState tone="neg" title={t('req.error')}>
          {requests.error}
        </EmptyState>
      </>
    );
  }

  const product =
    data.products.find(p => p.component === params.get('product')) ??
    data.products[0];
  const waiting = data.mine.filter(r => r.state === 'pending').length;
  const groupState = (g: AskableGroup) => {
    const state = askState(g);
    if (state === 'member')
      return (
        <Pill tone="pos" plain>
          {t('req.group.member')}
        </Pill>
      );
    if (state === 'pending')
      return (
        <Pill tone="warn" plain>
          {t('req.group.pending')}
        </Pill>
      );
    return (
      <Button
        size="small"
        variant="outlined"
        disabled={busy}
        onClick={() => setAsking(g.name)}
      >
        {t('req.ask')}
      </Button>
    );
  };
  const request = (r: AccessRequest) => (
    <>
      <Id>{r.group}</Id>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block' }}
      >
        {productTitle(r.component)}
      </Typography>
    </>
  );

  return (
    <>
      <TitleRow crumbs={crumbs} title={t('req.title')} sub={t('req.sub')} />
      <Kpis
        items={[
          {
            label: t('req.kpi.mine'),
            value: waiting,
            note: t('req.kpi.mine.note'),
          },
          ...(data.decides
            ? [
                {
                  label: t('req.kpi.decide'),
                  value: data.pending.length,
                  note: t('req.kpi.decide.note'),
                  tone: data.pending.length ? ('bad' as const) : undefined,
                },
              ]
            : []),
        ]}
      />
      {notice && (
        <Box role="status" sx={{ mb: 2 }}>
          <Pill tone={notice.tone}>{notice.text}</Pill>
        </Box>
      )}

      {data.decides && (
        <Section
          title={t('req.decide')}
          meta={t('req.decide.meta')}
          flush={data.pending.length > 0}
        >
          {!data.pending.length && (
            <Typography color="text.secondary">
              {t('req.decide.none')}
            </Typography>
          )}
          {data.pending.length > 0 && (
            <Table
              head={[
                t('req.col.when'),
                t('req.col.who'),
                t('req.col.group'),
                t('req.col.reason'),
                '',
              ]}
            >
              {data.pending.map(r => (
                <tr key={r.id}>
                  <Box
                    component="td"
                    sx={{
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {when(r.at)}
                  </Box>
                  <td>{r.requester}</td>
                  <td>{request(r)}</td>
                  <td>
                    {r.reason}
                    {rejecting === r.id && (
                      <ReasonForm
                        id={`reject-${r.id}`}
                        label={t('req.reject.why')}
                        send={t('req.reject')}
                        busy={busy}
                        onSend={why =>
                          run(
                            actions.reject(r.id, why),
                            t('req.done.rejected', {
                              user: r.requester,
                              group: r.group,
                            }),
                          )
                        }
                        onCancel={() => setRejecting(undefined)}
                      />
                    )}
                  </td>
                  <Box component="td" sx={{ whiteSpace: 'nowrap' }}>
                    {rejecting !== r.id && (
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                          size="small"
                          variant="contained"
                          disabled={busy}
                          onClick={() =>
                            run(
                              actions.approve(r.id),
                              t('req.done.approved', {
                                user: r.requester,
                                group: r.group,
                              }),
                            )
                          }
                        >
                          {t('req.approve')}
                        </Button>
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => setRejecting(r.id)}
                        >
                          {t('req.reject')}
                        </Button>
                      </Box>
                    )}
                  </Box>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      )}

      <Section
        title={t('req.askFor')}
        meta={t('req.askFor.meta')}
        flush={Boolean(product)}
        action={
          product && (
            <TextField
              select
              size="small"
              label={t('req.product')}
              value={product.component}
              onChange={e =>
                setParams({ product: e.target.value }, { replace: true })
              }
              sx={{ minWidth: 220 }}
            >
              {data.products.map(p => (
                <MenuItem key={p.component} value={p.component}>
                  {productTitle(p.component)}
                </MenuItem>
              ))}
            </TextField>
          )
        }
      >
        {!product && (
          <Typography color="text.secondary">{t('req.askFor.none')}</Typography>
        )}
        {product && (
          <Table head={[t('req.col.group'), t('req.col.gives'), '']}>
            {product.groups.map(g => (
              <tr key={g.name}>
                <td>
                  <Id>{g.name}</Id>
                  {g.admin && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block' }}
                    >
                      {t('req.group.admin')}
                    </Typography>
                  )}
                </td>
                <td>
                  {g.grants ?? '—'}
                  {asking === g.name && (
                    <ReasonForm
                      id={`ask-${g.name}`}
                      label={t('req.ask.why')}
                      send={t('req.ask.send')}
                      busy={busy}
                      onSend={why =>
                        run(
                          actions.ask(g.name, why),
                          t('req.done.asked', { group: g.name }),
                        )
                      }
                      onCancel={() => setAsking(undefined)}
                    />
                  )}
                </td>
                <Box
                  component="td"
                  sx={{ whiteSpace: 'nowrap', textAlign: 'right' }}
                >
                  {asking !== g.name && groupState(g)}
                </Box>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title={t('req.mine')} flush={data.mine.length > 0}>
        {!data.mine.length && (
          <Typography color="text.secondary">{t('req.mine.none')}</Typography>
        )}
        {data.mine.length > 0 && (
          <Table
            head={[
              t('req.col.when'),
              t('req.col.group'),
              t('req.col.state'),
              t('req.col.answer'),
              '',
            ]}
          >
            {data.mine.map(r => (
              <tr key={r.id}>
                <Box
                  component="td"
                  sx={{
                    whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {when(r.at)}
                </Box>
                <td>{request(r)}</td>
                <td>
                  <Pill tone={STATE_TONE[r.state]} plain>
                    {t(`req.state.${r.state}`)}
                  </Pill>
                </td>
                <td>
                  {r.state === 'pending' || r.state === 'withdrawn'
                    ? ''
                    : [
                        r.answer,
                        t('req.by', {
                          who: who(r.decidedBy),
                          when: when(r.decidedAt),
                        }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </td>
                <Box
                  component="td"
                  sx={{ whiteSpace: 'nowrap', textAlign: 'right' }}
                >
                  {r.state === 'pending' && (
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() =>
                        run(
                          actions.withdraw(r.id),
                          t('req.done.withdrawn', { group: r.group }),
                        )
                      }
                    >
                      {t('req.withdraw')}
                    </Button>
                  )}
                </Box>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {data.decides && data.decided.length > 0 && (
        <Section title={t('req.decided')} flush>
          <Table
            head={[
              t('req.col.when'),
              t('req.col.who'),
              t('req.col.group'),
              t('req.col.state'),
              t('req.col.answer'),
            ]}
          >
            {data.decided.map(r => (
              <tr key={r.id}>
                <Box
                  component="td"
                  sx={{
                    whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {when(r.decidedAt)}
                </Box>
                <td>{r.requester}</td>
                <td>{request(r)}</td>
                <td>
                  <Pill tone={STATE_TONE[r.state]} plain>
                    {t(`req.state.${r.state}`)}
                  </Pill>
                </td>
                <td>
                  {[r.answer, r.state === 'withdrawn' ? '' : who(r.decidedBy)]
                    .filter(Boolean)
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      )}
    </>
  );
};
