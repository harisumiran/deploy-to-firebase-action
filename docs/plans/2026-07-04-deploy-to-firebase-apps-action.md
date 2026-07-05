# Plan: deploy-to-firebase-action — Reusable GitHub Action

**Date:** 2026-07-04
**Repo:** `deploy-to-firebase-action` (new repo, github.com/harisumiran/deploy-to-firebase-action)

---

## Goal

Create a reusable composite GitHub Action that deploys a pre-built static directory to a
Firebase Hosting target, then trims old releases (keep latest N). Modelled on the pattern
of `harisumiran/deploy-to-k8s-action`. Callers (career-portal and future mini-apps) handle
building; this action handles deploying.

---

## Repo Structure

```
deploy-to-firebase-action/
├── action.yml               # composite action definition
├── scripts/
│   └── trim-releases.mjs    # Node ESM script: trim Firebase releases via REST API
└── README.md
```

No `node_modules` — the action installs its own tools via `run:` steps. Keeps the repo tiny.

---

## Slice 1 — `action.yml`

**Goal:** Define the composite action with all inputs, steps, and outputs.

```yaml
name: Deploy to Firebase Hosting
description: >
  Deploys a pre-built static directory to a Firebase Hosting target and trims
  old releases to keep the site history lean.

inputs:
  firebase_project_id:
    description: Firebase project ID (e.g. career-portal-prod)
    required: true
  hosting_target:
    description: Firebase Hosting target name (e.g. career-portal)
    required: true
  service_account:
    description: Firebase service account JSON (contents, not a file path)
    required: true
  build_dir:
    description: Directory containing the built files to deploy (e.g. dist)
    required: true
  keep_releases:
    description: Number of releases to keep. Older ones are deleted.
    required: false
    default: "5"

outputs:
  deploy_url:
    description: The live Firebase Hosting URL after deploy
    value: ${{ steps.deploy.outputs.deploy_url }}

runs:
  using: composite
  steps:
    - name: Install firebase-tools
      shell: bash
      run: npm install -g firebase-tools@latest --silent

    - name: Write service account to disk
      shell: bash
      run: |
        echo '${{ inputs.service_account }}' > /tmp/sa.json

    - name: Write firebase.json for target
      shell: bash
      run: |
        cat > /tmp/firebase-deploy.json <<EOF
        {
          "hosting": {
            "target": "${{ inputs.hosting_target }}",
            "public": "${{ inputs.build_dir }}",
            "ignore": ["firebase.json", "**/.*"]
          }
        }
        EOF

    - name: Deploy to Firebase Hosting
      id: deploy
      shell: bash
      env:
        GOOGLE_APPLICATION_CREDENTIALS: /tmp/sa.json
      run: |
        firebase deploy \
          --only hosting:${{ inputs.hosting_target }} \
          --project ${{ inputs.firebase_project_id }} \
          --config /tmp/firebase-deploy.json \
          --non-interactive 2>&1 | tee /tmp/deploy-output.txt

        URL=$(grep -oP 'https://[^ ]+\.web\.app' /tmp/deploy-output.txt | head -1)
        echo "deploy_url=${URL}" >> $GITHUB_OUTPUT

    - name: Trim old releases
      shell: bash
      env:
        GOOGLE_APPLICATION_CREDENTIALS: /tmp/sa.json
        FIREBASE_PROJECT_ID: ${{ inputs.firebase_project_id }}
        HOSTING_SITE: ${{ inputs.hosting_target }}
        KEEP_RELEASES: ${{ inputs.keep_releases }}
      run: node ${{ github.action_path }}/scripts/trim-releases.mjs

    - name: Clean up service account file
      if: always()
      shell: bash
      run: rm -f /tmp/sa.json
```

**Commit:** `feat: add action.yml composite action definition`

---

## Slice 2 — `scripts/trim-releases.mjs`

**Goal:** Node ESM script that uses the Firebase Hosting REST API to list all releases for
the site and delete any beyond the `KEEP_RELEASES` limit, oldest first.

Uses `google-auth-library` via the service account credential to get an access token.
The `GOOGLE_APPLICATION_CREDENTIALS` env var points to the service account JSON written
by the action step above.

```mjs
#!/usr/bin/env node
// Trims Firebase Hosting releases, keeping only the N most recent.
// Env vars: FIREBASE_PROJECT_ID, HOSTING_SITE, KEEP_RELEASES, GOOGLE_APPLICATION_CREDENTIALS

import { GoogleAuth } from "google-auth-library";

const { FIREBASE_PROJECT_ID, HOSTING_SITE, KEEP_RELEASES = "5" } = process.env;
const keepCount = parseInt(KEEP_RELEASES, 10);

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/firebase"],
});
const client = await auth.getClient();
const token = await client.getAccessToken();

const baseUrl = "https://firebasehosting.googleapis.com/v1beta1";
const siteName = `projects/${FIREBASE_PROJECT_ID}/sites/${HOSTING_SITE}`;

// Fetch up to 25 releases (well beyond any reasonable keepCount)
const listRes = await fetch(`${baseUrl}/${siteName}/releases?pageSize=25`, {
  headers: { Authorization: `Bearer ${token.token}` },
});
if (!listRes.ok) {
  console.error(
    `Failed to list releases: ${listRes.status} ${listRes.statusText}`,
  );
  process.exit(1);
}

const { releases = [] } = await listRes.json();
const toDelete = releases.slice(keepCount);

if (toDelete.length === 0) {
  console.log(
    `Releases within limit (${releases.length}/${keepCount}). Nothing to trim.`,
  );
  process.exit(0);
}

console.log(
  `Trimming ${toDelete.length} old release(s) (keeping ${keepCount})...`,
);

for (const release of toDelete) {
  const delRes = await fetch(`${baseUrl}/${release.name}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token.token}` },
  });
  if (delRes.ok) {
    console.log(`  Deleted: ${release.name}`);
  } else {
    // Non-fatal: log and continue, don't block the deploy
    console.warn(`  Could not delete ${release.name}: ${delRes.status}`);
  }
}
```

**Dependencies:** `google-auth-library` must be installed in the runner at trim time.
Add an install step before the trim step, or use a bundled version.

Update the `action.yml` trim step to install it first:

```yaml
- name: Trim old releases
  shell: bash
  env: ...
  run: |
    npm install --no-save google-auth-library 2>/dev/null
    node ${{ github.action_path }}/scripts/trim-releases.mjs
```

**Commit:** `feat: add trim-releases script to prune old Firebase Hosting releases`

---

## Slice 3 — `README.md`

Document inputs, outputs, required IAM roles, and a usage example.

### Required Firebase / Google IAM permissions for the service account

The service account needs:

- `Firebase Hosting Admin` role (`roles/firebasehosting.admin`)
- OR granular: `firebasehosting.releases.create`, `firebasehosting.releases.list`,
  `firebasehosting.releases.delete`, `firebasehosting.sites.get`

### Usage example (for caller workflows)

```yaml
- name: Deploy to Firebase Hosting
  uses: harisumiran/deploy-to-firebase-action@v1
  with:
    firebase_project_id: career-portal-prod
    hosting_target: career-portal
    service_account: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_PROD }}
    build_dir: dist
    keep_releases: "5"
```

**Commit:** `docs: add README with inputs, permissions, and usage example`

---

## Verify Checklist

- [ ] Action runs end-to-end in a test workflow against a staging Firebase project
- [ ] `deploy_url` output is populated after deploy
- [ ] Trim step: with 7 releases present, only 5 remain after action runs
- [ ] Trim step: with 3 releases present, 3 remain (no spurious deletes)
- [ ] Trim step: a delete failure (403) logs a warning but does not fail the overall action
- [ ] Service account file is removed in the `always()` cleanup step
- [ ] `firebase.json` used is the temp one written by the action, not caller's repo file

---

## Risks

| Risk                                              | Mitigation                                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `google-auth-library` install in runner is slow   | Cache `node_modules` in the runner — or bundle the script with `esbuild` into a single file in the repo to avoid runtime install |
| Firebase REST API rate limits on the delete calls | At most a few deletions per deploy — well within limits                                                                          |
| Service account JSON leaks in logs                | Written to `/tmp/sa.json` (not printed). Cleaned up in `always()` step.                                                          |
| Action version pinning by callers                 | Tag releases as `v1`, `v1.0.0` etc. Callers should pin to `@v1`.                                                                 |
