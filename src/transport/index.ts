// Transport layer: ONE generic adapter per platform, with a format-ручка (default json).
// Per-platform modules (sveltekit/express/ws) — отдельные сабпаты для tree-shaking; этот баррель
// реэкспортит всё для root-фасада. Адаптер = фузия платформы и Format (v1 backendAdapter pattern):
// читает сырое тело, декодирует в ЗНАЧЕНИЕ, зовёт value-level Binding, кодирует ответ, пишет в платформу.
// Protocol/format-agnostic. Раннее извлечение: opts.body (или express.json()) — decode пропускается.
// Адаптеры потребляют проекцию протокола: HTTP → { http }, fromWs → { message }, fromWsStream → { stream }.

export * from './sveltekit';
export * from './express';
export * from './ws';