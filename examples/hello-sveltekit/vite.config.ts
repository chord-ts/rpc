import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import swc from 'unplugin-swc';

export default defineConfig({
	plugins: [sveltekit(), swc.vite()],
});
