# Plan: Add `headers`/`rewrites` passthrough to deploy-to-firebase-action

**Date:** 2026-07-07
**Target repo:** `harisumiran/deploy-to-firebase-action` (external — not this repo)
**Reason this lives here:** career-portal is the caller that needs this change;
this file documents the plan so it can be copied into that repo's own `docs/plans/`.

---

## Context

`career-portal` (a micro-frontend) deploys via this action. Its `firebase.json`
defines `Access-Control-Allow-Origin: *` (required — the shell app loads
`mount.js`/`loadBundle.json` via a browser-side cross-origin `fetch()`, so without
CORS the browser blocks it), `Cache-Control` rules for long-term asset caching, and
a `/loadBundle` → `/loadBundle.json` rewrite.

None of that reaches production today. The action's "Write firebase.json for
target" step always generates its own minimal config from scratch and deploys
with `--config` pointing at that generated file — the caller's own
`firebase.json` in their repo is never read. This was actually a deliberate
design choice (see that repo's own
`docs/plans/2026-07-04-deploy-to-firebase-apps-action.md` verify checklist:
"firebase.json used is the temp one written by the action, not caller's repo
file") — it keeps the action self-contained instead of depending on
arbitrary caller-controlled files. That's a reasonable design. But it currently
has no way for a caller to supply the header/rewrite rules it actually needs,
which breaks the CORS requirement for career-portal's use case.

**Goal:** add optional `headers` / `rewrites` inputs (JSON array strings) that
get merged into the action's generated config, without changing the action's
self-contained design or any existing caller's behavior (both inputs default to
`"[]"`, so callers who don't pass them see identical output to today).

---

## Files to change (in deploy-to-firebase-action)

### 1. `scripts/build-firebase-config.mjs` (new)

Pure, testable logic for building the config — mirrors the existing
`trim-releases.mjs` pattern (exported functions + a CLI entry guarded by
`process.argv[1] === new URL(import.meta.url).pathname`).

```mjs
#!/usr/bin/env node
// Builds the firebase.json config the action deploys with, optionally
// merging in caller-supplied header/rewrite rules.
// Env vars: HOSTING_TARGET, BUILD_DIR, HEADERS_JSON, REWRITES_JSON

export function parseJsonArray(value) {
  if (value === undefined || value === "") {
    return [];
  }
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array");
  }
  return parsed;
}

export function buildFirebaseConfig({ site, publicDir, headers = [], rewrites = [] }) {
  return {
    hosting: {
      site,
      public: publicDir,
      ignore: ["firebase.json", "**/.*"],
      ...(headers.length > 0 ? { headers } : {}),
      ...(rewrites.length > 0 ? { rewrites } : {}),
    },
  };
}

function main() {
  const { HOSTING_TARGET, BUILD_DIR, HEADERS_JSON, REWRITES_JSON } = process.env;

  const config = buildFirebaseConfig({
    site: HOSTING_TARGET,
    publicDir: BUILD_DIR,
    headers: parseJsonArray(HEADERS_JSON),
    rewrites: parseJsonArray(REWRITES_JSON),
  });

  process.stdout.write(JSON.stringify(config, null, 2));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
```

### 2. `scripts/build-firebase-config.test.mjs` (new)

```mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFirebaseConfig, parseJsonArray } from "./build-firebase-config.mjs";

test("buildFirebaseConfig with no headers/rewrites omits those keys", () => {
  const config = buildFirebaseConfig({ site: "career-portal", publicDir: "dist" });
  assert.deepEqual(config, {
    hosting: {
      site: "career-portal",
      public: "dist",
      ignore: ["firebase.json", "**/.*"],
    },
  });
});

test("buildFirebaseConfig includes headers and rewrites when provided", () => {
  const headers = [
    { source: "/mount.js", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
  ];
  const rewrites = [{ source: "/loadBundle", destination: "/loadBundle.json" }];

  const config = buildFirebaseConfig({ site: "career-portal", publicDir: "dist", headers, rewrites });

  assert.deepEqual(config.hosting.headers, headers);
  assert.deepEqual(config.hosting.rewrites, rewrites);
});

test("parseJsonArray returns [] for empty string or undefined", () => {
  assert.deepEqual(parseJsonArray(""), []);
  assert.deepEqual(parseJsonArray(undefined), []);
});

test("parseJsonArray parses a valid JSON array string", () => {
  assert.deepEqual(parseJsonArray('[{"source":"/a","destination":"/b"}]'), [
    { source: "/a", destination: "/b" },
  ]);
});

test("parseJsonArray throws on invalid JSON so misconfiguration fails loudly", () => {
  assert.throws(() => parseJsonArray("{not valid json"));
});

test("parseJsonArray throws when given valid JSON that is not an array", () => {
  assert.throws(() => parseJsonArray('{"source":"/a"}'));
});
```

Verified locally: `node --test scripts/*.test.mjs` → 12/12 pass (6 new + the
existing 6 `trim-releases` tests, unaffected).

### 3. `action.yml` — add inputs + swap the config-writing step

Add after the existing `keep_releases` input:

```yaml
  headers:
    description: JSON array of Firebase Hosting header rules to apply (optional)
    required: false
    default: "[]"
  rewrites:
    description: JSON array of Firebase Hosting rewrite rules to apply (optional)
    required: false
    default: "[]"
```

Replace the "Write firebase.json for target" step body:

```yaml
    - name: Write firebase.json for target
      shell: bash
      env:
        HOSTING_TARGET: ${{ inputs.hosting_target }}
        BUILD_DIR: ${{ inputs.build_dir }}
        HEADERS_JSON: ${{ inputs.headers }}
        REWRITES_JSON: ${{ inputs.rewrites }}
      run: node ${{ github.action_path }}/scripts/build-firebase-config.mjs > /tmp/firebase-deploy.json
```

(Everything else in `action.yml` — install, service account write, deploy step,
trim step, cleanup — is unchanged.)

### 4. `README.md` — document the new inputs

Add two rows to the Inputs table:

```
| `headers`   | No | `[]` | JSON array of Firebase Hosting header rules to apply  |
| `rewrites`  | No | `[]` | JSON array of Firebase Hosting rewrite rules to apply |
```

Update the usage example to show them:

```yaml
- name: Deploy to Firebase Hosting
  uses: harisumiran/deploy-to-firebase-action@v1.0.0
  with:
    firebase_project_id: career-portal-prod
    hosting_target: career-portal
    service_account: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_PROD }}
    build_dir: dist
    keep_releases: "2"
    headers: |
      [
        {
          "source": "/mount.js",
          "headers": [
            { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" },
            { "key": "Access-Control-Allow-Origin", "value": "*" }
          ]
        }
      ]
    rewrites: |
      [
        { "source": "/loadBundle", "destination": "/loadBundle.json" }
      ]
```

---

## Backward compatibility

Both new inputs default to `"[]"`. `buildFirebaseConfig` only adds the
`headers`/`rewrites` keys to the generated config when the arrays are
non-empty, so any existing caller that doesn't pass these inputs gets byte-for-byte
the same generated config as before (`ignore` list unchanged, key order
unchanged since `hosting.headers`/`hosting.rewrites` are simply absent rather than
present-and-empty).

---

## Release

Keep using the `v1` tag (not bump to `v1.1.0`/similar) — after applying this
diff, re-tag `v1` (and `v1.0.0` if you want the same pattern as before) to the
new commit, same as was done to first publish `v1.0.0`.

## Verify checklist

- [ ] `node --test scripts/*.test.mjs` → 12/12 pass
- [ ] Manual smoke test: `HOSTING_TARGET=career-portal BUILD_DIR=dist HEADERS_JSON='[...]' REWRITES_JSON='[...]' node scripts/build-firebase-config.mjs` produces the expected JSON with headers/rewrites present
- [ ] Manual smoke test with `HEADERS_JSON`/`REWRITES_JSON` unset → output matches the old hardcoded shape exactly (no `headers`/`rewrites` keys)
- [ ] career-portal's three workflows (`deploy-dev.yml`, `deploy-qa.yml`, `deploy-prod.yml`) updated to pass `headers`/`rewrites` inputs once this is tagged
