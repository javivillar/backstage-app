import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback, useEffect, useState } from 'react';

/** The answer of GET /api/cluster/network (backend plugin cluster, clusterNetwork.ts). */
export type Isolation = 'open' | 'partial' | 'isolated';
export type PolicySummary = { name: string; appliesTo: string; from: string[]; to: string[]; ingress: boolean; egress: boolean };
export type NamespaceNetwork = {
  name: string;
  segment?: string;
  system: boolean;
  hosts: string[];
  isolation: Isolation;
  egressRestricted: boolean;
  policies: PolicySummary[];
  pods?: { ready: number; total: number };
};
export type HostNetwork = { host: string; namespace: string; ingress: string; service?: string; tls: boolean; tlsSource?: 'ingress' | 'cluster' };
export type ClusterCertificate = { name: string; namespace: string; dnsNames: string[]; notAfter?: string; ready: boolean };
export type SegmentNetwork = { name: string; policy?: string; order?: number; enforced: boolean; actions: string[]; namespaces: number };
export type ClusterNetwork = {
  generatedAt: string;
  warnings: string[];
  entry?: { service: string; namespace: string; ports: string[] };
  certificate?: ClusterCertificate;
  hosts: HostNetwork[];
  segments: SegmentNetwork[];
  namespaces: NamespaceNetwork[];
};

export const ISOLATION_TEXT: Record<Isolation, string> = { open: 'Open to the cluster', partial: 'Partly isolated', isolated: 'Isolated' };
export const isolationTone = (i: Isolation) => ({ open: 'warn', partial: 'info', isolated: 'ok' } as const)[i];

export function useClusterNetwork() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: ClusterNetwork; error?: string }>({ loading: true });
  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const res = await fetch(`${await discovery.getBaseUrl('cluster')}/network`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setState({ loading: false, data: body as ClusterNetwork });
    } catch (e) {
      setState({ loading: false, error: (e as Error).message });
    }
  }, [discovery, fetch]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

/** The Keycloak host of the cluster: the published host of the namespace of segment iam. */
export function identityHost(n: ClusterNetwork): string | undefined {
  const ns = n.namespaces.find(x => x.segment === 'iam' && x.hosts.length);
  return ns?.hosts.find(h => h.startsWith('iam.')) ?? ns?.hosts[0];
}

/** Days left of the cluster certificate, or undefined when it is not known. */
export function certificateDays(n: ClusterNetwork, now = new Date()): number | undefined {
  const t = n.certificate?.notAfter ? Date.parse(n.certificate.notAfter) : NaN;
  return Number.isNaN(t) ? undefined : Math.floor((t - now.getTime()) / 86_400_000);
}

/** Words for the TLS of a host: where its certificate comes from. */
export function tlsText(h: HostNetwork): string {
  if (h.tlsSource === 'cluster') return 'TLS · cluster certificate';
  if (h.tlsSource === 'ingress') return 'TLS · own certificate';
  return 'No TLS';
}

/** Calico Whisker, when the cluster publishes it. */
export const whiskerHost = (n: ClusterNetwork) => n.hosts.find(h => h.host.startsWith('whisker.'))?.host;
