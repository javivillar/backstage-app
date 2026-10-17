# sbom-backend

The backend of the **SBOM** tab: the CycloneDX SBOM that the CI of an application attached to each of its images in
the registry (`oras attach`, artifact type `application/vnd.cyclonedx+json`), for the images a component runs
(annotation `refresquito.io/sbom-images`, written by the catalog of refresquito-services with the tag deployed).

- `GET /api/sbom/image?ref=<image>`: its summary (components, ecosystems, licenses, the Refresquito frameworks).
- `GET /api/sbom/image/raw?ref=<image>`: the CycloneDX document.

It finds the SBOM with the referrers API of the registry, or in the tag `sha256-<hex>` that oras writes on a registry
without it. Signed-in users only; read only; only images under `sbom.allowedImages`.

```yaml
sbom:
  allowedImages: ['ghcr.io/javivillar/']
  dockerConfig: ${GHCR_DOCKERCONFIG}   # Docker config JSON with the pull credentials of the registry
```
