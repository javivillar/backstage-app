# sbom

The **SBOM** tab of a component that says the images it runs (annotation `refresquito.io/sbom-images`) or the releases
of GitHub of the libraries it is made of (`refresquito.io/sbom-releases`, `owner/repo@tag`), comma separated: per image
or release, the framework it carries, its ecosystems and licenses, and its components (search, filter by ecosystem,
download the CycloneDX JSON). The data comes from `sbom-backend`.

For each **image** it also shows its **vulnerabilities** as Wazuh's daily image scan (Trivy) found them: the counts by
severity of the last scan and every CRITICAL / HIGH finding with its package, installed version and the version that
fixes it (filter by severity, *with a fix*; the id links to the advisory). An image deployed after the daily run (03:10
UTC) says the last scan did not see it; one Wazuh could not pull says so.

With wazuh-oneke 0.20.0 each finding also carries the **context Wazuh computes** (USE-CASES.md I6 of wazuh-oneke):
whether it is in **CISA KEV** (exploited in the wild; a red *KEV* chip, *ransomware* when campaigns use it, linking to
CISA's entry), its **EPSS** (probability of exploitation in the next 30 days, percentile on hover) and how many
**days** its image repository has had it. The list is ordered by urgency — known exploited first (whatever their
severity: a known-exploited MEDIUM or LOW is listed too), then severity, then EPSS — and can be filtered to the
known exploited. Above it: how many KEV CVEs, the highest EPSS, the oldest fixable CRITICAL / HIGH, and the date of the
two feeds (a cached or stale feed says so; with the KEV feed missing the card says *unknown*, never 0).
