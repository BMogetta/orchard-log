// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// The deploy job installs wrangler from the small project in deploy/, while
// tests and local development use the one in the root project. What deploys
// has to be what was tested, so everything the deploy project installs must
// be something the root project installs too, byte for byte.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Entries of a top-level section of a pnpm lockfile, as { key: body }.
const section = (lockfile, name) => {
  const entries = new Map();
  let inside = false;
  let key = null;
  for (const line of lockfile.split("\n")) {
    if (/^\S/.test(line)) {
      inside = line === `${name}:`;
      key = null;
    } else if (inside && /^ {2}\S/.test(line)) {
      key = line.trim();
      entries.set(key, "");
    } else if (inside && key && line.trim()) {
      entries.set(key, entries.get(key) + line + "\n");
    }
  }
  return entries;
};

describe("deploy project", () => {
  const root = JSON.parse(read("package.json"));
  const deploy = JSON.parse(read("deploy/package.json"));
  const rootLock = read("pnpm-lock.yaml");
  const deployLock = read("deploy/pnpm-lock.yaml");

  it("holds nothing but the deploy tool", () => {
    expect(Object.keys(deploy).sort()).toEqual([
      "dependencies",
      "description",
      "name",
      "packageManager",
      "private",
    ]);
    expect(Object.keys(deploy.dependencies)).toEqual(["wrangler"]);
  });

  it("asks for the same wrangler and the same pnpm as the root project", () => {
    expect(deploy.dependencies.wrangler).toBe(root.devDependencies.wrangler);
    expect(deploy.packageManager).toBe(root.packageManager);
  });

  it("has a lockfile written for that range", () => {
    const importers = section(deployLock, "importers");
    expect([...importers.keys()]).toEqual([".:"]);
    expect(importers.get(".:")).toContain(`specifier: ${deploy.dependencies.wrangler}\n`);
  });

  it.each(["packages", "snapshots"])(
    "installs only what the root project installs (%s)",
    (name) => {
      const mine = section(deployLock, name);
      const theirs = section(rootLock, name);
      expect(mine.size).toBeGreaterThan(0);
      for (const [key, body] of mine) {
        expect(theirs.has(key), `${key} is not in the root lockfile`).toBe(true);
        expect(body, `${key} differs from the root lockfile`).toBe(theirs.get(key));
      }
    }
  );

  it("takes every package from the registry, with a checksum", () => {
    for (const [key, body] of section(deployLock, "packages")) {
      expect(body, key).toMatch(
        /^ {4}resolution: \{integrity: sha512-[A-Za-z0-9+/=]+\}$/m
      );
      expect(body, key).not.toMatch(/tarball:|https?:|git[+@:]|link:|file:/);
    }
  });

  it("keeps the same install rules as the root project", () => {
    const rules = (text) =>
      text
        .split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .join("\n");
    expect(rules(read("deploy/pnpm-workspace.yaml"))).toBe(
      rules(read("pnpm-workspace.yaml"))
    );
  });
});
