// Fixture-контракт официального MCP-рефери, выраженный декларациями chord.
//
// Клонирован КОНТРАКТ, а не код: имена, схемы и поведение взяты из апстримного
// modelcontextprotocol/typescript-sdk, test/conformance/src/everythingServer.ts
// (пин коммита 5ee54ee30ddc00a914a3d981880f87fdce0e6246, MIT/Apache-2.0 переход).
// Сам файл написан под API SDK (registerTool/registerResource/registerPrompt) — здесь то же
// самое через `fn` + meta, чтобы шли валидация, DI и реестр chord.
//
// Объём: scored-набор ревизии 2026-07-28. Legacy-тулы прежних ревизий (test_sampling,
// test_elicitation, test_reconnection, test_logging_tool) и tasks-расширение SEP-2663 не
// клонируются — нашим набором они не скорятся.
//
// Имена тулов в MCP плоские (`test_image_content`), а реестр chord адресует `Service.method`.
// Поэтому имя задаётся через `mcp.name`, профиль строит по нему индекс. Resources/prompts
// различаются meta-полями `mcp.resource` / `mcp.prompt` и в tools/list не попадают.

import { z } from 'zod';
import { fn } from '../../..';

// 1×1 PNG и минимальный WAV — те же константы, что у апстрима.
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const TEST_AUDIO_BASE64 = 'UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAA=';

const text = (t: string) => ({ type: 'text', text: t });

/** Тулы: контент-блоки MCP возвращаются как есть (CallToolResult), профиль их не оборачивает. */
export class ConformanceTools {
  constructor() {}

  static $simpleText = fn({ in: z.object({}), desc: 'Tests simple text response', mcp: { name: 'test_simple_text' } });
  simpleText: typeof ConformanceTools.$simpleText.fn = async () => ({
    content: [text('This is a simple text response for testing.')],
  });

  static $image = fn({ in: z.object({}), desc: 'Tests image content response', mcp: { name: 'test_image_content' } });
  image: typeof ConformanceTools.$image.fn = async () => ({
    content: [{ type: 'image', data: TEST_IMAGE_BASE64, mimeType: 'image/png' }],
  });

  static $audio = fn({ in: z.object({}), desc: 'Tests audio content response', mcp: { name: 'test_audio_content' } });
  audio: typeof ConformanceTools.$audio.fn = async () => ({
    content: [{ type: 'audio', data: TEST_AUDIO_BASE64, mimeType: 'audio/wav' }],
  });

  static $embedded = fn({ in: z.object({}), desc: 'Tests embedded resource content response', mcp: { name: 'test_embedded_resource' } });
  embedded: typeof ConformanceTools.$embedded.fn = async () => ({
    content: [
      { type: 'resource', resource: { uri: 'test://embedded-resource', mimeType: 'text/plain', text: 'This is an embedded resource content.' } },
    ],
  });

  static $mixed = fn({ in: z.object({}), desc: 'Tests response with multiple content types (text, image, resource)', mcp: { name: 'test_multiple_content_types' } });
  mixed: typeof ConformanceTools.$mixed.fn = async () => ({
    content: [
      text('Multiple content types test:'),
      { type: 'image', data: TEST_IMAGE_BASE64, mimeType: 'image/png' },
      { type: 'resource', resource: { uri: 'test://mixed-content-resource', mimeType: 'application/json', text: JSON.stringify({ test: 'data', value: 123 }) } },
    ],
  });

  static $error = fn({ in: z.object({}), desc: 'Tests error handling', mcp: { name: 'test_error_handling' } });
  error: typeof ConformanceTools.$error.fn = async () => {
    throw new Error('This is a test error for conformance testing');
  };

  // Прогресс пока не эмитится профилем (request-scoped notifications — открытый пробел),
  // тул объявлен, чтобы контракт был полным и сценарий был виден как незакрытый.
  static $progress = fn({ in: z.object({}), desc: 'Tests progress notifications', mcp: { name: 'test_tool_with_progress' } });
  progress: typeof ConformanceTools.$progress.fn = async () => ({ content: [text('Progress tool completed')] });

  // SEP-2575: требует sampling-capability клиента → -32021. Гейтинг и MRTR — открытый пробел.
  static $missingCapability = fn({ in: z.object({}), desc: 'SEP-2575: requires the sampling client capability', mcp: { name: 'test_missing_capability' } });
  missingCapability: typeof ConformanceTools.$missingCapability.fn = async () => ({ content: [text('sampling round-trip complete')] });
}

/** Ресурсы: `mcp.resource` задаёт uri (или uriTemplate) и метаданные для resources/list. */
export class ConformanceResources {
  constructor() {}

  static $staticText = fn({
    in: z.object({ uri: z.string() }),
    desc: 'A static text resource for testing',
    mcp: { resource: { name: 'static-text', uri: 'test://static-text', title: 'Static Text Resource', mimeType: 'text/plain' } },
  });
  staticText: typeof ConformanceResources.$staticText.fn = async () => ({
    contents: [{ uri: 'test://static-text', mimeType: 'text/plain', text: 'This is the content of the static text resource.' }],
  });

  static $staticBinary = fn({
    in: z.object({ uri: z.string() }),
    desc: 'A static binary resource (image) for testing',
    mcp: { resource: { name: 'static-binary', uri: 'test://static-binary', title: 'Static Binary Resource', mimeType: 'image/png' } },
  });
  staticBinary: typeof ConformanceResources.$staticBinary.fn = async () => ({
    contents: [{ uri: 'test://static-binary', mimeType: 'image/png', blob: TEST_IMAGE_BASE64 }],
  });

  static $template = fn({
    in: z.object({ uri: z.string() }),
    desc: 'A resource template with parameter substitution',
    mcp: { resource: { name: 'template', uriTemplate: 'test://template/{id}/data', title: 'Resource Template', mimeType: 'application/json' } },
  });
  template: typeof ConformanceResources.$template.fn = async ({ uri }) => {
    const id = /test:\/\/template\/([^/]+)\/data/.exec(uri)?.[1] ?? '';
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ id, templateTest: true, data: `Data for ID: ${id}` }) }] };
  };

  static $watched = fn({
    in: z.object({ uri: z.string() }),
    desc: 'Static resource registered for subscribe/unsubscribe testing',
    mcp: { resource: { name: 'watched-resource', uri: 'test://watched-resource', title: 'Watched Resource', mimeType: 'text/plain' } },
  });
  watched: typeof ConformanceResources.$watched.fn = async () => ({
    contents: [{ uri: 'test://watched-resource', mimeType: 'text/plain', text: 'Watched resource content v1' }],
  });
}

/** Промпты: `mcp.prompt` задаёт имя и аргументы для prompts/list. */
export class ConformancePrompts {
  constructor() {}

  static $simple = fn({
    in: z.object({}),
    desc: 'A simple prompt without arguments',
    mcp: { prompt: { name: 'test_simple_prompt', title: 'Simple Test Prompt' } },
  });
  simple: typeof ConformancePrompts.$simple.fn = async () => ({
    messages: [{ role: 'user', content: text('This is a simple prompt for testing.') }],
  });

  static $withArgs = fn({
    in: z.object({ arg1: z.string(), arg2: z.string() }),
    desc: 'A prompt with required arguments',
    mcp: {
      prompt: {
        name: 'test_prompt_with_arguments',
        title: 'Prompt With Arguments',
        arguments: [
          { name: 'arg1', description: 'First test argument', required: true },
          { name: 'arg2', description: 'Second test argument', required: true },
        ],
      },
    },
  });
  withArgs: typeof ConformancePrompts.$withArgs.fn = async ({ arg1, arg2 }) => ({
    messages: [{ role: 'user', content: text(`Prompt with arguments: arg1='${arg1}', arg2='${arg2}'`) }],
  });

  static $embedded = fn({
    in: z.object({ resourceUri: z.string() }),
    desc: 'A prompt that includes an embedded resource',
    mcp: {
      prompt: {
        name: 'test_prompt_with_embedded_resource',
        title: 'Prompt With Embedded Resource',
        arguments: [{ name: 'resourceUri', description: 'URI of the resource to embed', required: true }],
      },
    },
  });
  embedded: typeof ConformancePrompts.$embedded.fn = async ({ resourceUri }) => ({
    messages: [
      { role: 'user', content: { type: 'resource', resource: { uri: resourceUri, mimeType: 'text/plain', text: 'Embedded resource content for testing.' } } },
      { role: 'user', content: text('Please process the embedded resource above.') },
    ],
  });

  static $withImage = fn({
    in: z.object({}),
    desc: 'A prompt that includes image content',
    mcp: { prompt: { name: 'test_prompt_with_image', title: 'Prompt With Image' } },
  });
  withImage: typeof ConformancePrompts.$withImage.fn = async () => ({
    messages: [
      { role: 'user', content: { type: 'image', data: TEST_IMAGE_BASE64, mimeType: 'image/png' } },
      { role: 'user', content: text('Please describe the image above.') },
    ],
  });
}

export const fixtureServices = {
  ConformanceTools,
  ConformanceResources,
  ConformancePrompts,
};
