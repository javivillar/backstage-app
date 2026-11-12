import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback, useEffect, useState } from 'react';
import type { AccessRequest } from './accessAdmin';

/**
 * The client of /api/keycloak-manager/evidence (plugins/keycloak-backend evidenceRoutes.ts): Control and evidence.
 * What needs a decision in who has access to what, the activity recorded, the report of access now and at each
 * signed snapshot, and the proposals of double approval.
 */

export type FindingKind = 'no-admin' | 'single-admin' | 'inactive' | 'sensitive' | 'empty' | 'no-owner';
export type Finding = { kind: FindingKind; tone: 'bad' | 'warn' | 'info'; subject?: string; count: number; names: string[]; recent?: number; product?: string };
export type Overview = { findings: Finding[]; kpis: { atRisk: number; inactive: number; approvals: number; changesWeek: number }; signIns: boolean; inactiveDays: number; recentDays: number };
export type ActivityKind = 'access' | 'approval' | 'refused';
export type Activity = { at: string; who: string; kind: ActivityKind; action: string; username: string; group: string; component: string; note?: string };
export type ReportRow = { component: string; group: string; members: string[] };
export type PersonRow = { username: string; groups: string[] };
export type Snapshot = { id: number; at: string; takenBy: string; digest: string; signature?: string; groups: number; people: number };
export type Report = {
  of: { at: string; live: boolean; id?: number; takenBy?: string; digest?: string; signature?: string; state?: 'ok' | 'unsigned' | 'altered' };
  rows: ReportRow[];
  people: PersonRow[];
  snapshots: Snapshot[];
  /** whether snapshots can be kept (a database) and whether they are signed (an evidence key) */
  kept: boolean;
  signs: boolean;
};
export type Approvals = { pending: AccessRequest[]; decided: AccessRequest[]; me: string; decides: boolean; kept: boolean };

/** Where a finding is acted on: Access administration on its product, or on nothing in particular. */
export const findingLink = (f: Finding): string => (f.product ? `/console/access-administration?product=${encodeURIComponent(f.product)}` : '/console/access-administration');

/** The activity of one kind, or all of it. */
export const ofKind = (activity: Activity[], kind: ActivityKind | 'all') => (kind === 'all' ? activity : activity.filter(a => a.kind === kind));

const cell = (v: string | number) => {
  const text = String(v);
  // a value that a spreadsheet would run as a formula is kept as text
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** A CSV file as text: a header and one line per row. */
export const csv = (head: string[], rows: Array<Array<string | number>>): string => [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n');

/** The report of access as CSV, with what it is a report of: the moment, and the digest and signature of a snapshot. */
export function reportCsv(report: Report, by: 'product' | 'person'): string {
  const body = by === 'product' ? csv(['product', 'group', 'people', 'members'], report.rows.map(r => [r.component, r.group, r.members.length, r.members.join(' ')])) : csv(['person', 'groups held', 'groups'], report.people.map(p => [p.username, p.groups.length, p.groups.join(' ')]));
  const foot = [
    ['access as of', report.of.at],
    ...(report.of.digest ? [['sha256', report.of.digest]] : []),
    ...(report.of.signature ? [['signature', report.of.signature]] : []),
  ];
  return `${body}\r\n\r\n${csv(['', ''], foot).split('\r\n').slice(1).join('\r\n')}\r\n`;
}

/** Saves a text as a file from the browser. */
export function save(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function useEvidenceFetch() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  return useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(`${await discovery.getBaseUrl('keycloak-manager')}/evidence${path}`, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      return body as T;
    },
    [discovery, fetch],
  );
}

type Loaded<T> = { loading: boolean; data?: T; error?: string; reload: () => void };

/** Reads one of the four parts of the page; nothing while `path` is undefined (a tab not open). */
export function useEvidence<T>(path: string | undefined): Loaded<T> {
  const get = useEvidenceFetch();
  const [n, setN] = useState(0);
  const [state, setState] = useState<{ loading: boolean; data?: T; error?: string }>({ loading: Boolean(path) });
  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    setState(s => ({ ...s, loading: true, error: undefined }));
    get<T>(path).then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [get, path, n]);
  const reload = useCallback(() => setN(x => x + 1), []);
  return { ...state, reload };
}
