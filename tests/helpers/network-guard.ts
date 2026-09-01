import { createRequire } from "node:module";

const marker = Symbol.for("wuda-law-job-radar.network-guard");
const guardedGlobal = globalThis as typeof globalThis & { [marker]?: boolean };

if (!guardedGlobal[marker]) {
  const networkError = () => new Error("Network access is disabled in tests");
  const blocked = () => {
    throw networkError();
  };

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async () => Promise.reject(networkError())
  });

  const require = createRequire(import.meta.url);
  const targets: Array<[Record<string, unknown>, string]> = [
    [require("node:http"), "request"],
    [require("node:http"), "get"],
    [require("node:https"), "request"],
    [require("node:https"), "get"],
    [require("node:net"), "connect"],
    [require("node:net"), "createConnection"],
    [require("node:tls"), "connect"]
  ];

  for (const [target, property] of targets) {
    Object.defineProperty(target, property, {
      configurable: true,
      writable: true,
      value: blocked
    });
  }

  guardedGlobal[marker] = true;
}
