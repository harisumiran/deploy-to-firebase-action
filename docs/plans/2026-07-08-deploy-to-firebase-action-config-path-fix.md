# Plan: Fix build_dir resolution in deploy-to-firebase-action

**Date:** 2026-07-08
**Target repo:** `harisumiran/deploy-to-firebase-action` (external — not this repo)
**Reason this lives here:** career-portal is the caller that hit this bug during
the dev deploy; this file documents the plan so it can be copied into that
repo's own `docs/plans/`.

---

## Context

career-portal's dev deploy failed with:

```
Error: Directory 'dist' for Hosting does not exist.
```

...even though the "Build (dev)" step ran successfully and `dist/` definitely
existed in the checkout (confirmed — the very next step, "Write
loadBundle.json", writes into `dist/loadBundle.json` and did not fail).

**Root cause:** the "Write firebase.json for target" step writes the
generated config to `/tmp/firebase-deploy.json`, then the deploy step runs
`firebase deploy --config /tmp/firebase-deploy.json`. Firebase CLI's project
root detection (`detectProjectRoot()` in firebase-tools) uses the **directory
containing the `--config` file** as the project root when `--config` is
passed, and resolves every relative path in that config (including
`hosting.public`) against that root. So `"public": "dist"` resolves to
`/tmp/dist` — which never exists — regardless of where the actual build
output lives. There's no `--cwd` flag on the CLI to override this
independently of `--config`.

This is a latent bug that predates the `headers`/`rewrites` change — it was
never hit before because no caller had actually run a real deploy through this
action until now.

**Fix:** write the generated config into the caller's own checkout directory
(the default working directory for composite action `run:` steps) instead of
`/tmp`, so the config file's directory is the same place `$BUILD_DIR` (e.g.
`dist`) actually lives.

---

## File to change

### `action.yml`

Change the "Write firebase.json for target" step's output target and the
deploy step's `--config` flag from `/tmp/firebase-deploy.json` to
`./.deploy-to-firebase-action-config.json` (written into
`$GITHUB_WORKSPACE`, next to `dist`):

```yaml
    - name: Write firebase.json for target
      shell: bash
      env:
        HOSTING_TARGET: ${{ inputs.hosting_target }}
        BUILD_DIR: ${{ inputs.build_dir }}
        HEADERS_JSON: ${{ inputs.headers }}
        REWRITES_JSON: ${{ inputs.rewrites }}
      # Written into the caller's checkout (not /tmp): firebase deploy resolves
      # "public" relative to the --config file's own directory, so the config
      # must live next to $BUILD_DIR or the deploy fails with
      # "Directory '<build_dir>' for Hosting does not exist."
      run: node ${{ github.action_path }}/scripts/build-firebase-config.mjs > ./.deploy-to-firebase-action-config.json

    - name: Deploy to Firebase Hosting
      id: deploy
      shell: bash
      env:
        GOOGLE_APPLICATION_CREDENTIALS: /tmp/sa.json
        HOSTING_TARGET: ${{ inputs.hosting_target }}
        FIREBASE_PROJECT_ID: ${{ inputs.firebase_project_id }}
      run: |
        firebase deploy \
          --only "hosting:$HOSTING_TARGET" \
          --project "$FIREBASE_PROJECT_ID" \
          --config ./.deploy-to-firebase-action-config.json \
          --non-interactive 2>&1 | tee /tmp/deploy-output.txt

        URL=$(grep -oE 'https://[^ ]+\.(web\.app|firebaseapp\.com)' /tmp/deploy-output.txt | head -1)
        echo "deploy_url=${URL}" >> $GITHUB_OUTPUT
```

And clean the generated file up alongside the service account file:

```yaml
    - name: Clean up service account file
      if: always()
      shell: bash
      run: rm -f /tmp/sa.json ./.deploy-to-firebase-action-config.json
```

(`sa.json` stays in `/tmp` — no reason to move it; only the Hosting config
needs to live next to `dist`.)

No changes to `scripts/build-firebase-config.mjs` or its tests — the bug is
purely in where `action.yml` writes/points at the file, not in how the
config's contents are built. `node --test scripts/*.test.mjs` still passes
12/12 unchanged.

---

## Verify checklist

- [ ] `node --test scripts/*.test.mjs` → 12/12 pass (unchanged, confirms no script logic touched)
- [ ] Re-run career-portal's dev deploy after tagging this fix → should get past "beginning deploy..." without the "Directory 'dist' does not exist" error
- [ ] Confirm `.deploy-to-firebase-action-config.json` does not linger in the checkout after a run (cleanup step removes it)
- [ ] Re-tag `v1` (and `v1.0.0`-style tag if you keep that convention) to the new commit
