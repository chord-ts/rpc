import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc';

export default defineConfig({
	plugins: [swc.vite()],
	test: {
		include: ['./tests/v1/*.{test,spec}.{js,ts}', './src/**/*.test.ts'],
		exclude: ['./docs/*', './dist', './coverage']
	}
});
