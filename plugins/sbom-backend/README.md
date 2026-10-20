# sbom-backend

The backend of the **SBOM** tab: the CycloneDX SBOM that the CI of an application attached to each of its images in
the registry (`oras attach`, artifact type `application/vnd.cyclonedx+json`), for the images a component runs
(annotation `refresquito.io/sbom-images`, written by the catalog of refresquito-services with the tag deployed).

- `GET /api/sbom/image?ref=<image>`: its summary (components, ecosystems, licenses, the Refresquito frameworks).
- `GET /api/sbom/image/raw?ref=<image>`: the CycloneDX document.
- `GET /api/sbom/vulnerabilities?ref=<image>`: its vulnerabilities from Wazuh's daily image scan (Trivy), as the
  security exporter of wazuh-oneke serves them (`GET <sbom.vulnerabilitiesUrl>/vulnerabilities?digest=`, then
  `?image=`): `{configured, digest, scan}`; `scan` is null when the last run did not see the image. Kept 5 minutes.
- `GET /api/sbom/release?ref=<owner/repo@tag>` and `/release/raw`: the same for the SBOM file (`*.cdx.json`) of a
  release of GitHub, for a library (annotation `refresquito.io/sbom-releases`), read with the token of
  `integrations.github`.

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
