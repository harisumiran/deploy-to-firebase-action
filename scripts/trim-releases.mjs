#!/usr/bin/env node
// Trims Firebase Hosting releases, keeping only the N most recent.
// Env vars: FIREBASE_PROJECT_ID, HOSTING_SITE, KEEP_RELEASES, GOOGLE_APPLICATION_CREDENTIALS

export function parseKeepCount(value) {
  const keepCount = parseInt(value, 10);
  if (!Number.isInteger(keepCount) || keepCount < 1) {
    return null;
  }
  return keepCount;
}

export function pickReleasesToDelete(releases, keepCount) {
  return releases.slice(keepCount);
}

async function main() {
  const { FIREBASE_PROJECT_ID, HOSTING_SITE, KEEP_RELEASES = "2" } = process.env;
  const keepCount = parseKeepCount(KEEP_RELEASES);
  if (keepCount === null) {
    console.error(`Invalid KEEP_RELEASES: "${KEEP_RELEASES}"`);
    process.exit(1);
  }

  const { GoogleAuth } = await import("google-auth-library");
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
  const toDelete = pickReleasesToDelete(releases, keepCount);

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
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
