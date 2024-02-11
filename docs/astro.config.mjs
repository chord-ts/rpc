import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwind from '@astrojs/tailwind';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

// https://astro.build/config
export default defineConfig({
  // vite: {
    // server: {
      // watch: 
    // }
  // },
  integrations: [
    starlight({
      title: 'Chord Docs',
      social: {
        github: 'https://github.com/chord-ts/rpc'
      },
      sidebar: [
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' }
        },
        {
          label: 'Guides',
          autogenerate: { directory: 'guides' }

        },
				typeDocSidebarGroup
      ],
      customCss: ['./src/tailwind.css'],
      plugins: [
        // Generate the documentation.
        starlightTypeDoc({
          entryPoints: ['../src/index.ts'],
          tsconfig: '../tsconfig.json',
          pagination: true,
          // watch: true,
        })
      ]
    }),
    tailwind({ applyBaseStyles: false })
  ]
});
