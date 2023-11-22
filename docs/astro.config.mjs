import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { generateTypeDoc } from 'starlight-typedoc'

const typeDocSidebarGroup = await generateTypeDoc({
  entryPoints: ['../src/index.ts'],
  tsconfig: '../tsconfig.json',
})


// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Chord Docs',
			social: {
				github: 'https://github.com/dmdin/chord',
			},
			sidebar: [
				{
					label: 'Guides',
					items: [
						// Each item here is one entry in the navigation menu.
						{ label: 'Example Guide', link: '/guides/example/' },
					],
				},
				{
					label: 'Reference',
					autogenerate: { directory: 'reference' },
				},
				typeDocSidebarGroup
			],
		}),
	],
});
