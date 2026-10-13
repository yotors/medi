# Environment verification — 2026-10-12

This report covers the development environment, not application readiness.

| Check | Result |
| --- | --- |
| `npm run doctor` with local daemon access | Passed; Node, pinned packages, Chromium, BMad, Impeccable skill, uv, MCP config file, Docker |
| `npm run test:tooling` | 4 passed: interaction and positive/negative axe checks at desktop/mobile sizes |
| UI audit command against temporary local HTTP fixture | Passed both viewports; screenshots and JSON produced; no accessibility violations or runtime errors |
| k6 against temporary local HTTP fixture | Passed: 1 VU, 10 seconds, 10 successful requests; harness validation only |
| `npm audit` after parser override | 0 known vulnerabilities in the tooling dependency tree |
| BMad configuration resolver | Passed using local uv |
| BMad catalogs with patched CSV parser | 27 help rows and 29 skill rows parsed successfully |
| Context7 local MCP | Initialize and tool-list handshake passed; two tools advertised |
| Playwright local MCP | Initialize and tool-list handshake passed |
| Impeccable engine | Checksum-verified engine 0.1.14 launched successfully |
| Semgrep container | Version 1.179.0 executable verified |
| Trivy container | Version 0.75.0 executable verified |
| k6 container | Version 2.3.0 executable verified |
| ZAP container | Version 2.17.0 executable verified |
| Container image downloads | Semgrep, Trivy, k6 and ZAP downloaded by pinned Linux amd64 digest |
| Configuration syntax | Python, JavaScript, shell, TOML and CI YAML checked |

Execution notes:

- Browser startup and Docker daemon access required execution outside the Codex
  command sandbox. The checks passed under approved execution; no persistent
  sandbox or approval policy was changed.
- After explicit user approval, only this repository was added to Codex's
  trusted-project list. `codex mcp get` confirmed that Context7, Playwright,
  and OpenAI Docs are discovered and enabled. A new task in this folder is
  needed to expose the tools to the conversation.
- OpenAI Docs MCP is configured but its remote handshake was not tested.
- Context7's local protocol was tested; a live documentation query was not tested.
- CI jobs are written and syntax-checked, but no GitHub remote or workflow run
  exists. Required branch checks are not configured.
- Application security scans, authenticated tests, observability, production
  deployment, restoration, and capacity tests await a defined product.

Local artifacts are under `artifacts/`: package audit JSON, browser reports,
UI screenshots and JSON, container pull logs, and k6 summary JSON. Artifacts
are intentionally excluded from Git.
