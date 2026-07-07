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
