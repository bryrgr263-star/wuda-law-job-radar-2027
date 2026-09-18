import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function assertHistoricalEvidenceReadAllowed(locator: string): void {
  const normalized = locator.replaceAll("\\", "/");
  const resolved = path.resolve(repositoryRoot, locator);
  const relative = path.relative(repositoryRoot, resolved);
  const outside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || (path.win32.isAbsolute(locator) && process.platform !== "win32");
  const historical = /\.(?:html?|xlsx?|docx?|wps|pdf)$/i.test(normalized)
    || /(?:snapshot|requirement-set-composition|canary-execution)\.json$/i.test(normalized);
  if (/(?:^|\/)outputs(?:\/|$)/i.test(normalized) || (outside && historical)) {
    throw new Error(`Historical evidence read outside versioned fixture boundary: ${locator}`);
  }
}

function checkReadLocator(locator: unknown): void {
  if (locator instanceof URL) {
    assertHistoricalEvidenceReadAllowed(fileURLToPath(locator));
  } else if (typeof locator === "string" || Buffer.isBuffer(locator)) {
    assertHistoricalEvidenceReadAllowed(locator.toString());
  }
}

for (const operation of ["readFileSync", "readFile", "openSync", "open", "createReadStream"] as const) {
  const original = fs[operation];
  Object.defineProperty(fs, operation, {
    configurable: true,
    writable: true,
    value: (...parameters: unknown[]) => {
      checkReadLocator(parameters[0]);
      return Reflect.apply(original, fs, parameters);
    }
  });
}
for (const operation of ["readFile", "open"] as const) {
  const original = fs.promises[operation];
  Object.defineProperty(fs.promises, operation, {
    configurable: true,
    writable: true,
    value: async (...parameters: unknown[]) => {
      checkReadLocator(parameters[0]);
      return Reflect.apply(original, fs.promises, parameters);
    }
  });
}
syncBuiltinESMExports();
