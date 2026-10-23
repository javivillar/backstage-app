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

It also shows whether each finding is **in use** — its package has been loaded by a process of the image, as the
Wazuh agents of the nodes saw it (*yes*, *no*, *?* for language packages or images not observed long enough) — its
CVSS **attack** vector, and the **exposure** of the image (reachable from outside the cluster through an Ingress /
IngressRoute / NodePort, on the network of the node, inside the cluster only, or not exposed). Findings in packages
never loaded are listed after the ones in use and can be filtered (*In use*: never loaded).

The card *Tests, coverage & code findings* has a last tab, **Code findings**, from the same quality report (template
line 3.1, `.github/endpoints.py`): who can call each operation of the API (the ones with no authentication that are not
declared public first, in red; the operations of the framework on demand), and every finding of Bandit, of the eslint
rules of security, of gitleaks (git history) and of Trivy (images), the worst first — rule, file and line, never the
secret.

The SBOM card of each image also applies the **license policy** of the platform to the dependencies of the application
(pypi, npm, maven... — not the packages of the OS of the image, where GPL programs are normal): the ones with a
license the policy denies (GPL, AGPL, SSPL..., `sbom.licenses.denied`) in red, and the ones that say no license at all.
A license expression is denied only when no allowed license can satisfy it (`MIT OR GPL-3.0` is allowed). The
Vulnerabilities card says when the **OS of the image is out of support** (no more security fixes; wazuh-oneke 0.21.0).
