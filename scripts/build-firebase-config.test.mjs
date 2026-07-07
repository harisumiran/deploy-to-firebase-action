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
