// events: самоадресуемый протокол событий (AG-UI-стиль) — подписка {method, params} → поток.
// Только stream-проекция: унарного HTTP-маппинга нет, и это честно видно в типах
// (fromSvelteKit(events(core)) — ошибка типов). Потребляет третий глагол ядра (core.stream).

import type { Core } from '../core/types';
import type { StreamProtocol } from '../types';

export function events(core: Core<any>): StreamProtocol {
  return {
    stream: {
      handle(value, ctx) {
        const req = value as { method: string; params?: unknown };
        return core.stream(req.method, req.params, { ctx });
      },
    },
  };
}
