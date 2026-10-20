// Teste de fumaça: executa o script de index.html em Node com um DOM falso e falha se a
// inicialização der erro (ex.: usar uma constante antes de declarada). Uso: node tools/testar_pagina.js
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const code = scripts[scripts.length - 1];

const stub = () => new Proxy(function () {}, {
  get(t, k) {
    if (k === Symbol.toPrimitive) return () => "";
    if (k === "value" || k === "textContent" || k === "innerHTML" || k === "hash" || k === "dataset") return k === "dataset" ? {} : "";
    if (k === "then") return undefined;
    if (k === Symbol.iterator) return function* () {};
    if (k === "length") return 0;
    return stub();
  },
  apply() { return stub(); },
  set() { return true; },
});
const store = {};
const ctx = {
  document: Object.assign(stub(), {
    querySelector: () => stub(), querySelectorAll: () => [], getElementById: () => stub(),
    addEventListener: () => {}, createElement: () => stub(), documentElement: stub(), body: stub(),
  }),
  window: {},
  location: { hash: "#tema-trabalho", href: "http://x/", pathname: "/", hostname: "x" },
  history: { replaceState() {} },
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
  navigator: {},
  fetch: async u => {
    const f = path.join(ROOT, String(u).split("?")[0]);
    if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, "utf8")) };
  },
  addEventListener: () => {}, innerWidth: 1200, CSS: { escape: s => s }, URL, setTimeout, clearTimeout, setInterval, clearInterval, console,
};
ctx.window = ctx;
const errors = [];
process.on("unhandledRejection", e => errors.push("promise: " + (e && e.stack || e)));
try {
  new Function(...Object.keys(ctx), code)(...Object.values(ctx));
  console.log("init sem erro síncrono");
} catch (e) {
  console.log("ERRO:", e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n") : e);
}
setTimeout(() => console.log(errors.length ? errors.join("\n") : "sem erros assíncronos"), 1500);
