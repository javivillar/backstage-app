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
      /** charged once per deployment: a new version of an image running in a namespace (backend plugin costs) */
      perDeployment?: number;
      /** charged once per incident opened on an element of a namespace (application support), by its priority */
      perIncident?: { P1?: number; P2?: number; P3?: number; P4?: number };
    };
  };
  /**
   * Deployments of each namespace (backend plugin costs of packages/backend): the Prometheus that scrapes
   * kube-state-metrics. Without it deployments are not counted.
   */
  costs?: {
    prometheusUrl?: string;
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
