// The pure-JS GOST library uses Node's `global` spelling; Workers uses globalThis.
if (typeof globalThis.global === 'undefined') {
  Object.defineProperty(globalThis, 'global', { value: globalThis, configurable: true });
}
