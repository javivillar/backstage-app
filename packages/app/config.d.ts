export interface Config {
  /** Homepage configuration
   * @visibility frontend
   */
  homepage?: {
    /**
     * Title of the hero of the homepage. Default: "Internal Developer Platform".
     * @visibility frontend
     */
    title?: string;
    /**
     * Line under the title. Default: "Discover, manage, and deploy your services".
     * @visibility frontend
     */
    subtitle?: string;
    /**
     * Quick links displayed on the homepage
     * @visibility frontend
     */
    quickLinks?: Array<{
      /**
       * URL for the quick link
       * @visibility frontend
       */
      url: string;
      /**
       * Display label
       * @visibility frontend
       */
      label: string;
      /**
       * Icon identifier (e.g. 'catalog')
       * @visibility frontend
       */
      icon?: string;
      /**
       * URL to an icon image
       * @visibility frontend
       */
      iconUrl?: string;
    }>;
  };
  /**
   * Costs (Cost card of each entity, page /costs): OpenCost is read through the proxy /opencost; these are the
   * currency and the prices it computes with (ours, not a bill), shown next to the figures.
   * @deepVisibility frontend
   */
  opencost?: {
    /** ISO 4217 code, e.g. EUR */
    currency?: string;
    pricing?: {
      description?: string;
      cpuPerCoreHour?: number;
      ramPerGiBHour?: number;
      storagePerGiBHour?: number;
      /**
       * The rest of what OpenCost can charge with our own prices (FinOps › Prices of the console): a GPU per hour and
       * the node label that names its model, the prices of low-priority (spot) nodes and the "label=value" that marks
       * them, traffic per GiB, a load balancer per hour, and the discounts (percent) on the nodes.
       */
      gpuPerHour?: number;
      gpuNodeLabel?: string;
      spot?: { cpuPerCoreHour?: number; ramPerGiBHour?: number; nodeLabel?: string };
      network?: { zoneEgressPerGiB?: number; regionEgressPerGiB?: number; internetEgressPerGiB?: number; gatewayEgressPerGiB?: number; gatewayIngressPerGiB?: number };
      loadBalancer?: { perHour?: number };
      discount?: { sustainedUse?: number; negotiated?: number };
      /** charged once per deployment: a new version of an image running in a namespace (backend plugin costs) */
      perDeployment?: number;
      /** charged once per incident opened on an element of a namespace (application support), by its priority */
      perIncident?: { P1?: number; P2?: number; P3?: number; P4?: number };
      /**
       * What the assistants consume (plugin ops-assistant), charged to the system each question was about. The first
       * entry whose model (part of the model name, or '*') and runner (api, claude-code) match is its price: per
       * million tokens, or per hour of answering (a local model: the server is what costs).
       */
      assistants?: Array<{
        model?: string;
        runner?: string;
        inputPerMillion?: number;
        outputPerMillion?: number;
        cacheReadPerMillion?: number;
        cacheWritePerMillion?: number;
        perHour?: number;
      }>;
    };
  };
  /**
   * Deployments of each namespace (backend plugin costs of packages/backend): the Prometheus that scrapes
   * kube-state-metrics. Without it deployments are not counted.
   */
  costs?: {
    prometheusUrl?: string;
    /**
     * The prices (FinOps › Prices of the console): where they are read and changed with a pull request, and who may
     * change them besides backstage-admin and console.actions.groups. Defaults: console.manage.repo, main,
     * cnoe-oneke, ['finops'].
     */
    prices?: { repo?: string; branch?: string; chart?: string; groups?: string[] };
  };
  /**
   * Tech Radar shown at /tech-radar: technologies and where the organization stands on each.
   * @deepVisibility frontend
   */
  techRadar?: {
    /** The four quadrants (kinds of technology) */
    quadrants?: Array<{ id: string; name: string }>;
    /** Rings, from the centre outwards. Default: adopt, trial, assess, hold */
    rings?: Array<{
      id: string;
      name: string;
      color: string;
      description?: string;
    }>;
    entries?: Array<{
      id: string;
      title: string;
      /** id of a quadrant */
      quadrant: string;
      /** id of a ring */
      ring: string;
      /** Date of the decision (YYYY-MM-DD) */
      date?: string;
      description?: string;
      url?: string;
    }>;
  };
}
