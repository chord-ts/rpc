import { expect, test } from '@playwright/test';

// Сценарии страницы /v2/rpc: вызовы, ошибки, simple-эндпоинты, discovery, формат, DI.
test('v2 rpc page runs jsonrpc scenarios', async ({ page }) => {
	await page.goto('/v2/rpc');

	// Последний сценарий (DI из locals) — значит, отработали все предыдущие.
	await expect(page.getByText('Session.whoami = demo-user')).toBeVisible();

	await expect(page.getByText('Math.add({ a: 2, b: 3 }) = 5')).toBeVisible();
	await expect(page.getByText(/валидация входа \(a: 'x'\): RpcError -32602: Validation error · data: \[/)).toBeVisible();
	await expect(page.getByText('неизвестный метод Math.nope: RpcError -32601: Method not found: Math.nope')).toBeVisible();
	await expect(page.getByText('Math.div({ a: 7, b: 2 }) = 3.5')).toBeVisible();
	await expect(page.getByText(/бизнес-ошибка div на 0: RpcError -32000: Division by zero · data: \{"a":1,"b":0\}/)).toBeVisible();
	await expect(page.getByText('обычный Error в sqrt(-1): RpcError -32603: Internal error')).toBeVisible();
	await expect(page.getByText("Greeter.echo('ping') = ping")).toBeVisible();
	await expect(page.getByText("Greeter.greet('Hello', 'World') = Hello, World!")).toBeVisible();
	await expect(page.getByText(/rpc\.discover \(POST\): OpenRPC 1\.3\.2 · Math\.add, Math\.div, Math\.sqrt, Math\.sumAll, Clock\.now, Scalars\.upper, .*Greeter\.echo, Greeter\.greet, Session\.whoami/)).toBeVisible();
	await expect(page.getByText(/Clock\.now \(out: z\.date\(\)\): string →/)).toBeVisible();
});