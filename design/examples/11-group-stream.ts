// 11 · Group-stream (вариант 3b, спайк). CRDT-доска: stream({ in, event, group, backpressure })
// + типизированные publish/subscribe-хэндлы на декларации (без magic strings). Общий генератор
// на комнату (дедуп по ключу) тапает subscribe-хэндл и деривирует события; fan-out / refcount /
// backpressure держит канал ядра. Связь applyUpdate → events — явный publish. Src не тронут.
// Прогон: npx tsc --noEmit --strict --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --skipLibCheck design/examples/11-group-stream.ts

import { z } from 'zod';
import { fn, CoreError } from '../../src';
import { stream, compose } from './helpers/group-stream';

// общее состояние комнаты (персистентный CRDT-док; упрощённо — map ячеек)
const docs = new Map<string, Map<string, string>>();
const docOf = (room: string) => {
  let d = docs.get(room);
  if (!d) { d = new Map(); docs.set(room, d); }
  return d;
};

const Update = z.object({ room: z.string(), cell: z.string(), value: z.string() });
const BoardEvent = z.object({ room: z.string(), cells: z.record(z.string(), z.string()) });

class Board {
  constructor() {}

  // клиент→сервер: применить update к общему доку и опубликовать снапшот в канал комнаты
  static $applyUpdate = fn({ in: Update, out: z.object({ ok: z.boolean() }) });
  applyUpdate: typeof Board.$applyUpdate.fn = async (u) => {
    docOf(u.room).set(u.cell, u.value);
    Board.$events.publish(u.room, { room: u.room, cells: Object.fromEntries(docOf(u.room)) }); // типизированный publish
    return { ok: true };
  };

  // сервер→клиент: общий генератор на комнату; subscribe-хэндл даёт сырой feed, генератор деривирует
  static $events = stream({
    in: z.object({ room: z.string() }),
    event: BoardEvent,
    group: (i) => i.room, // ключ группы: один канал/продюсер на комнату
    backpressure: 'reliable', // буфер без потерь; переполнение → disconnect подписчика
  });
  events: typeof Board.$events.fn = async function* ({ room }, signal) {
    // здесь можно деривировать (троттлинг/агрегация/снапшоты); снапшот уже собран в publish
    for await (const e of Board.$events.subscribe(room, signal)) yield e;
  };
}

const composer = compose({ Board }, { inject: {} });

(async () => {
  // два подписчика одной комнаты — общий продюсер, fan-out канала
  const a = composer.stream('Board.events', { room: 'r1' })[Symbol.asyncIterator]();
  const b = composer.stream('Board.events', { room: 'r1' })[Symbol.asyncIterator]();

  await composer.call('Board.applyUpdate', { room: 'r1', cell: 'A1', value: 'x' });
  console.log('11 sub A →', (await a.next()).value); // { room: 'r1', cells: { A1: 'x' } }
  console.log('11 sub B →', (await b.next()).value); // тот же снапшот (fan-out)

  await composer.call('Board.applyUpdate', { room: 'r1', cell: 'B2', value: 'y' });
  console.log('11 sub A →', (await a.next()).value); // { A1: 'x', B2: 'y' }
  console.log('11 sub B →', (await b.next()).value);

  // отмена подписчика A → B продолжает получать (refcount: продюсер жив, пока есть подписчики)
  await a.return?.();
  await composer.call('Board.applyUpdate', { room: 'r1', cell: 'C3', value: 'z' });
  console.log('11 sub B после отмены A →', (await b.next()).value); // { A1, B2, C3 }
  await b.return?.();

  // другая комната — отдельный канал/продюсер
  const c = composer.stream('Board.events', { room: 'r2' })[Symbol.asyncIterator]();
  await composer.call('Board.applyUpdate', { room: 'r2', cell: 'A1', value: 'other' });
  console.log('11 room r2 →', (await c.next()).value); // { room: 'r2', cells: { A1: 'other' } }
  await c.return?.();

  // backpressure (reliable): медленный подписчик не блокирует продюсера; переполнение буфера
  // (limit 64) → disconnect этого подписчика, остальные не страдают.
  const slow = composer.stream('Board.events', { room: 'bp' })[Symbol.asyncIterator]();
  for (let i = 0; i < 70; i++) {
    await composer.call('Board.applyUpdate', { room: 'bp', cell: `c${i}`, value: `${i}` });
  }
  try {
    await slow.next();
    console.log('11 backpressure → без overflow (буфер вместил)');
  } catch (e) {
    console.log('11 backpressure reliable →', (e as CoreError).message); // overflow → disconnect
  }
  await slow.return?.();
})();
