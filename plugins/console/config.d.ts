export interface Config {
  /**
   * The cloud-style console (/console). It lives next to the classic pages, which do not change.
   * @visibility frontend
   */
  console?: {
    /**
     * Shows the console and its link in the sidebar. Default false: an instance without this key looks exactly as before.
     * @visibility frontend
     */
    enabled?: boolean;
    /**
     * Keycloak groups that may open the console (e.g. console-beta). Empty or missing: every signed-in user.
     * @visibility frontend
     */
    allowedGroups?: string[];
    /**
     * Base URL of the classic pages, when the console runs on another host (the preview instance). Default: this host.
     * @visibility frontend
     */
    classicBaseUrl?: string;
    /**
     * The cluster this portal belongs to.
     * @visibility frontend
     */
    cluster?: {
      /** @visibility frontend */
      id?: string;
      /**
       * zone (e.g. nato: infrastructure and marketplace of the zone) or program (e.g. nato-sirtap).
       * @visibility frontend
       */
      kind?: 'zone' | 'program';
      /** @visibility frontend */
      zone?: string;
      /** @visibility frontend */
      program?: string;
    };
    /**
     * The other clusters reachable from the cluster selector. Their console is embedded in a frame.
     * @visibility frontend
     */
    clusters?: Array<{
      /** @visibility frontend */
      id: string;
      /** @visibility frontend */
      kind: 'zone' | 'program';
      /**
       * Base URL of its portal, e.g. https://backstage.platform.nato.sirtap.iaas.refresquito.io
       * @visibility frontend
       */
      url: string;
      /** @visibility frontend */
      zone?: string;
      /** @visibility frontend */
      program?: string;
    }>;
  };
}
