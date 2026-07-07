# Deploy to Firebase Hosting

Reusable composite GitHub Action that deploys a pre-built static directory to a Firebase
Hosting target, then trims old releases (keeping the latest N). Callers handle building;
this action handles deploying.

## Inputs

| Name                   | Required | Default | Description                                                |
| ---------------------- | -------- | ------- | ------------------------------------------------------------ |
| `firebase_project_id`  | Yes      | —       | Firebase project ID (e.g. `career-portal-prod`)             |
| `hosting_target`       | Yes      | —       | Firebase Hosting site ID (e.g. `career-portal`)             |
| `service_account`      | Yes      | —       | Firebase service account JSON (contents, not a file path)   |
| `build_dir`            | Yes      | —       | Directory containing the built files to deploy (e.g. `dist`) |
| `keep_releases`        | No       | `2`     | Number of releases to keep. Older ones are deleted.         |
| `headers`              | No       | `[]`    | JSON array of Firebase Hosting header rules to apply         |
| `rewrites`             | No       | `[]`    | JSON array of Firebase Hosting rewrite rules to apply         |

## Outputs

| Name         | Description                              |
| ------------ | ----------------------------------------- |
| `deploy_url` | The live Firebase Hosting URL after deploy |

## Required Firebase / Google IAM permissions for the service account

The service account needs:

- `Firebase Hosting Admin` role (`roles/firebasehosting.admin`)
- OR granular: `firebasehosting.releases.create`, `firebasehosting.releases.list`,
  `firebasehosting.releases.delete`, `firebasehosting.sites.get`

## Usage example

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

## Development

### Running tests

```bash
npm test
```

The test suite calls `parseKeepCount()` and `pickReleasesToDelete()` from
`scripts/trim-releases.mjs` directly with fixture inputs, using Node's built-in
test runner (no dependencies to install).
