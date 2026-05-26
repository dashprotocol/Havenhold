# Contributing to Havenhold

## Branch Naming

Use the project ticket format:

- `feat/H-###-short-name`
- `fix/H-###-short-name`
- `chore/H-###-short-name`

Example: `feat/H-001-repo-baseline-docs`

## Pull Request Expectations

Each PR should include:

- Linked ticket id in title/body.
- Clear summary of behavior changes.
- Notes on data model or API changes.
- Any manual test steps performed.

## Branch Protection Requirement

To enforce quality gates, set branch protection on `main` and require these status checks:

- `Frontend lint/test/build`
- `Backend build`

## Local Quality Checks

Run before opening a PR:

```bash
npm run lint
npm run test
npm run build
cd server && npm run build && cd ..
```

## Data and Security Rules

- Do not commit secrets, credentials, or production PHI.
- Use synthetic data for local and demo scenarios.
- Keep `.env` files local-only.
- Keep uploads and generated build artifacts out of git.

## Scope Guidance

Prefer small, focused PRs:

- One feature or bug fix per PR.
- Keep refactors separate from feature changes when possible.
- Add/update docs when architecture or setup changes.
