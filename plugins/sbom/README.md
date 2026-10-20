# sbom

The **SBOM** tab of a component that says the images it runs (annotation `refresquito.io/sbom-images`) or the releases
of GitHub of the libraries it is made of (`refresquito.io/sbom-releases`, `owner/repo@tag`), comma separated: per image
or release, the framework it carries, its ecosystems and licenses, and its components (search, filter by ecosystem,
download the CycloneDX JSON). The data comes from `sbom-backend`.

For each **image** it also shows its **vulnerabilities** as Wazuh's daily image scan (Trivy) found them: the counts by
severity of the last scan and every CRITICAL / HIGH finding with its package, installed version and the version that
fixes it (filter by severity, *with a fix*; the id links to the advisory). An image deployed after the daily run (03:10
UTC) says the last scan did not see it; one Wazuh could not pull says so.
