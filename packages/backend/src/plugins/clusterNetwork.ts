/**
 * How this cluster is reached and isolated, for the console (Network page and the User journey / Network tabs of an
 * entity): namespaces and their segment, published hosts (Ingress), NetworkPolicies and the Calico segment policies.
 * Read-only; summarised here so the page does not need the raw objects.
 */

type Labels = Record<string, string> | undefined;
type Selector = { matchLabels?: Labels; matchExpressions?: Array<{ key: string; operator: string; values?: string[] }> } | undefined;
type Peer = { namespaceSelector?: Selector; podSelector?: Selector; ipBlock?: { cidr: string; except?: string[] } };
type Port = { protocol?: string; port?: number | string; endPort?: number };
type Rule = { from?: Peer[]; to?: Peer[]; ports?: Port[] };

export type K8sNamespace = { metadata: { name: string; labels?: Labels } };
export type K8sIngress = {
  metadata: { name: string; namespace: string };
  spec?: { tls?: Array<{ hosts?: string[] }>; rules?: Array<{ host?: string; http?: { paths?: Array<{ backend?: { service?: { name?: string } } }> } }> };
};
export type K8sNetworkPolicy = {
  metadata: { name: string; namespace: string };
  spec?: { podSelector?: Selector; policyTypes?: string[]; ingress?: Rule[]; egress?: Rule[] };
};
export type CalicoGlobalPolicy = {
  metadata: { name: string };
  spec?: { order?: number; namespaceSelector?: string; ingress?: Array<{ action?: string }>; egress?: Array<{ action?: string }> };
};
export type TraefikTlsStore = { metadata: { name: string; namespace: string }; spec?: { defaultCertificate?: { secretName?: string } } };
export type CertManagerCertificate = {
  metadata: { name: string; namespace: string };
  spec?: { secretName?: string; dnsNames?: string[] };
  status?: { notAfter?: string; conditions?: Array<{ type: string; status: string }> };
};
export type K8sService = { metadata: { name: string; namespace: string; labels?: Labels }; spec?: { type?: string; ports?: Array<{ port?: number; nodePort?: number; name?: string }> } };

export type Isolation = 'open' | 'partial' | 'isolated';
export type PolicySummary = { name: string; appliesTo: string; from: string[]; to: string[]; ingress: boolean; egress: boolean };
export type NamespaceNetwork = {
  name: string;
  segment?: string;
  system: boolean;
  hosts: string[];
  /** ingress isolation by NetworkPolicy: open (none), partial (some pods), isolated (every pod) */
  isolation: Isolation;
  /** whether some policy restricts what it can reach (egress) */
  egressRestricted: boolean;
  policies: PolicySummary[];
  pods?: { ready: number; total: number };
};
/** tls: 'ingress' (the Ingress declares it), 'cluster' (the default certificate of Traefik covers the name), or none */
export type HostNetwork = { host: string; namespace: string; ingress: string; service?: string; tls: boolean; tlsSource?: 'ingress' | 'cluster' };
export type ClusterCertificate = { name: string; namespace: string; dnsNames: string[]; notAfter?: string; ready: boolean };
export type SegmentNetwork = { name: string; policy?: string; order?: number; enforced: boolean; actions: string[]; namespaces: number };
export type ClusterNetwork = {
  generatedAt: string;
  /** what could not be read (e.g. a permission the chart has not granted yet) */
  warnings: string[];
  entry?: { service: string; namespace: string; ports: string[] };
  /** the default certificate of Traefik (TLSStore default), as cert-manager issues it: never the secret */
  certificate?: ClusterCertificate;
  hosts: HostNetwork[];
  segments: SegmentNetwork[];
  namespaces: NamespaceNetwork[];
};

export const SEGMENT_LABEL = 'refresquito.io/segment';
const SYSTEM = /^(kube-|calico-|tigera-|longhorn-|metallb-|cert-manager|traefik-|one-system|default$)/;

export function selectorText(sel: Selector): string {
  if (!sel) return 'all';
  const parts = Object.entries(sel.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`);
  for (const e of sel.matchExpressions ?? []) parts.push(`${e.key} ${e.operator.toLowerCase()} ${(e.values ?? []).join(',')}`.trim());
  return parts.length ? parts.join(', ') : 'all';
}

function peerText(p: Peer): string {
  if (p.ipBlock) return `addresses ${p.ipBlock.cidr}${p.ipBlock.except?.length ? ` except ${p.ipBlock.except.join(', ')}` : ''}`;
  const nsName = p.namespaceSelector?.matchLabels?.['kubernetes.io/metadata.name'];
  let ns = 'this namespace';
  if (nsName) ns = `namespace ${nsName}`;
  else if (p.namespaceSelector) ns = `namespaces ${selectorText(p.namespaceSelector)}`;
  const pods = p.podSelector && selectorText(p.podSelector) !== 'all' ? `pods ${selectorText(p.podSelector)} in ` : '';
  return pods + ns;
}

function portsText(ports?: Port[]): string {
  if (!ports?.length) return '';
  return ` (${ports.map(p => `${p.protocol ?? 'TCP'} ${p.port ?? 'any'}${p.endPort ? `-${p.endPort}` : ''}`).join(', ')})`;
}

function rulesText(rules: Rule[] | undefined, key: 'from' | 'to'): string[] {
  const out: string[] = [];
  for (const r of rules ?? []) {
    const peers = r[key];
    const ports = portsText(r.ports);
    if (!peers || peers.length === 0) out.push(`anywhere${ports}`);
    else for (const p of peers) out.push(peerText(p) + ports);
  }
  return out;
}

export function summarisePolicy(np: K8sNetworkPolicy): PolicySummary {
  const types = np.spec?.policyTypes ?? (np.spec?.egress ? ['Ingress', 'Egress'] : ['Ingress']);
  return {
    name: np.metadata.name,
    appliesTo: selectorText(np.spec?.podSelector),
    ingress: types.includes('Ingress'),
    egress: types.includes('Egress'),
    from: types.includes('Ingress') ? rulesText(np.spec?.ingress, 'from') : [],
    to: types.includes('Egress') ? rulesText(np.spec?.egress, 'to') : [],
  };
}

export function isolationOf(policies: PolicySummary[]): Isolation {
  const ingress = policies.filter(p => p.ingress);
  if (ingress.some(p => p.appliesTo === 'all')) return 'isolated';
  return ingress.length ? 'partial' : 'open';
}

/** Whether a certificate name (maybe *.domain) covers a host. */
export function covers(name: string, host: string): boolean {
  if (name === host) return true;
  if (!name.startsWith('*.')) return false;
  const base = name.slice(1);
  return host.endsWith(base) && !host.slice(0, -base.length).includes('.');
}

function clusterCertificate(stores: TraefikTlsStore[], certs: CertManagerCertificate[]): ClusterCertificate | undefined {
  const store = stores.find(t => t.metadata.name === 'default' && t.spec?.defaultCertificate?.secretName);
  if (!store) return undefined;
  const secret = store.spec?.defaultCertificate?.secretName;
  const cert = certs.find(c => c.metadata.namespace === store.metadata.namespace && c.spec?.secretName === secret);
  if (!cert) return { name: secret ?? 'default', namespace: store.metadata.namespace, dnsNames: [], ready: true };
  return {
    name: cert.metadata.name,
    namespace: cert.metadata.namespace,
    dnsNames: cert.spec?.dnsNames ?? [],
    notAfter: cert.status?.notAfter,
    ready: (cert.status?.conditions ?? []).some(c => c.type === 'Ready' && c.status === 'True'),
  };
}

export function summariseNetwork(input: {
  namespaces: K8sNamespace[];
  ingresses: K8sIngress[];
  policies: K8sNetworkPolicy[];
  calico: CalicoGlobalPolicy[];
  services: K8sService[];
  tlsStores?: TraefikTlsStore[];
  certificates?: CertManagerCertificate[];
  pods?: Record<string, { ready: number; total: number }>;
  warnings?: string[];
  now?: Date;
}): ClusterNetwork {
  const certificate = clusterCertificate(input.tlsStores ?? [], input.certificates ?? []);
  const hosts: HostNetwork[] = [];
  for (const ing of input.ingresses) {
    const tlsHosts = new Set((ing.spec?.tls ?? []).flatMap(t => t.hosts ?? []));
    for (const rule of ing.spec?.rules ?? []) {
      if (!rule.host) continue;
      const host = rule.host;
      let tlsSource: HostNetwork['tlsSource'];
      if (tlsHosts.has(host)) tlsSource = 'ingress';
      else if (certificate?.dnsNames.some(n => covers(n, host))) tlsSource = 'cluster';
      hosts.push({
        host,
        namespace: ing.metadata.namespace,
        ingress: ing.metadata.name,
        service: rule.http?.paths?.[0]?.backend?.service?.name,
        tls: !!tlsSource,
        tlsSource,
      });
    }
  }
  hosts.sort((a, b) => a.host.localeCompare(b.host));

  const byNs = new Map<string, PolicySummary[]>();
  for (const np of input.policies) {
    const list = byNs.get(np.metadata.namespace) ?? [];
    list.push(summarisePolicy(np));
    byNs.set(np.metadata.namespace, list);
  }

  const namespaces: NamespaceNetwork[] = input.namespaces.map(ns => {
    const name = ns.metadata.name;
    const policies = byNs.get(name) ?? [];
    return {
      name,
      segment: ns.metadata.labels?.[SEGMENT_LABEL],
      system: SYSTEM.test(name),
      hosts: hosts.filter(h => h.namespace === name).map(h => h.host),
      isolation: isolationOf(policies),
      egressRestricted: policies.some(p => p.egress),
      policies,
      pods: input.pods?.[name],
    };
  });
  namespaces.sort((a, b) => a.name.localeCompare(b.name));

  const segmentNames = [...new Set(namespaces.map(n => n.segment).filter((s): s is string => !!s))].sort();
  const segments: SegmentNetwork[] = segmentNames.map(name => {
    const policy = input.calico.find(p => (p.spec?.namespaceSelector ?? '').replace(/\s/g, '') === `${SEGMENT_LABEL}=="${name}"`);
    const actions = [...new Set([...(policy?.spec?.ingress ?? []), ...(policy?.spec?.egress ?? [])].map(r => r.action ?? 'Allow'))];
    return {
      name,
      policy: policy?.metadata.name,
      order: policy?.spec?.order,
      // Pass hands the decision on (to the namespace's own policies): the segment itself restricts nothing yet
      enforced: actions.some(a => a !== 'Pass'),
      actions,
      namespaces: namespaces.filter(n => n.segment === name).length,
    };
  });

  const traefik = input.services.find(s => s.metadata.labels?.['app.kubernetes.io/name'] === 'traefik');
  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    warnings: input.warnings ?? [],
    certificate,
    entry: traefik
      ? {
          service: traefik.metadata.name,
          namespace: traefik.metadata.namespace,
          ports: (traefik.spec?.ports ?? []).map(p => `${p.port}${p.nodePort ? `→${p.nodePort}` : ''}`),
        }
      : undefined,
    hosts,
    segments,
    namespaces,
  };
}
