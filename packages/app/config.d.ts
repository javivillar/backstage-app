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
}
