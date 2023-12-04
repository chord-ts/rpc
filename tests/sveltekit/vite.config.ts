import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
	plugins: [sveltekit(), swc.vite()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
