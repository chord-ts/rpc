import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';

export default defineConfig({
	plugins: [swc.vite()],
	resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
	test: {
		include: ['./tests/v1/*.{test,spec}.{js,ts}', './src/**/*.test.ts'],
		exclude: ['./docs/*', './dist', './coverage']
	}
});
