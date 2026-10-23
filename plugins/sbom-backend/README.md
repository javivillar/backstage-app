# sbom-backend

The backend of the **SBOM** tab: the CycloneDX SBOM that the CI of an application attached to each of its images in
the registry (`oras attach`, artifact type `application/vnd.cyclonedx+json`), for the images a component runs
(annotation `refresquito.io/sbom-images`, written by the catalog of refresquito-services with the tag deployed).

- `GET /api/sbom/image?ref=<image>`: its summary (components, ecosystems, licenses, the Refresquito frameworks).
- `GET /api/sbom/image/raw?ref=<image>`: the CycloneDX document.
- `GET /api/sbom/vulnerabilities?ref=<image>`: its vulnerabilities from Wazuh's daily image scan (Trivy), as the
  security exporter of wazuh-oneke serves them (`GET <sbom.vulnerabilitiesUrl>/vulnerabilities?digest=`, then
  `?image=`): `{configured, digest, scan}`; `scan` is null when the last run did not see the image. Kept 5 minutes.
  From wazuh-oneke 0.20.0 the scan carries the context Wazuh adds: per finding `epss`, `epss_pct`, `kev`,
  `kev_added`, `kev_due`, `kev_ransomware`, `first_seen`, `age_days`; per image `context` (`kev`, `epss_max`,
  `critical_fix_max_days`, `high_fix_max_days`...) and the `feeds` it was computed with. Passed through as is.
- `GET /api/sbom/release?ref=<owner/repo@tag>` and `/release/raw`: the same for the SBOM file (`*.cdx.json`) of a
  release of GitHub, for a library (annotation `refresquito.io/sbom-releases`), read with the token of
  `integrations.github`.

The fact retriever of the scorecard (`refresquitoSupplyChainFactRetriever`, `src/techInsights.ts`) reads the same
endpoints. From the context of Wazuh it only takes the maximum over the images of the application: `vulnContext`
(every image scanned, with context and the KEV feed), `knownExploited` (distinct CVEs of CISA KEV, -1 unknown),
`knownExploitedRansomware`, `knownExploitedIds`, `epssMax`, `criticalFixMaxDays`, `highFixMaxDays` (days the oldest
fixable one has been open, -1 none), and from the packages in use and the exposure of each image (wazuh-oneke I7):
`criticalFixInUseMaxDays`, `highFixInUseMaxDays` (only the findings in use or unknown), `knownExploitedInUse`,
`criticalNotInUse`, `criticalNetworkExposed`, `exposure` (the most exposed image). The SLA thresholds are checks of app-config (cnoe-oneke
`backstage.techInsights.sla`), not code.

It finds the SBOM with the referrers API of the registry, or in the tag `sha256-<hex>` that oras writes on a registry
without it. Signed-in users only; read only; only images under `sbom.allowedImages`.

```yaml
sbom:
  allowedImages: ['ghcr.io/javivillar/']
  dockerConfig: ${GHCR_DOCKERCONFIG}   # Docker config JSON with the pull credentials of the registry
  allowedReleases: ['javivillar/']     # only releases of these repositories
  # the security exporter of wazuh-oneke (0.19.0+); empty: the tab shows no vulnerabilities
  vulnerabilitiesUrl: http://wazuh-oneke-security-exporter.<prefix>wazuh-oneke.svc.cluster.local:9950
```
