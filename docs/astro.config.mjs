import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwind from '@astrojs/tailwind';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: 'Chord Docs',
      social: {
        github: 'https://github.com/chord-ts/rpc'
      },
      sidebar: [
        {
          label: 'Guides',
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Example Guide', link: '/guides/example/' }
          ]
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' }
        },
				typeDocSidebarGroup
      ],
      customCss: ['./src/tailwind.css'],
      plugins: [
        // Generate the documentation.
        starlightTypeDoc({
          entryPoints: ['../src/index.ts'],
          tsconfig: '../tsconfig.json'
        })
      ]
    }),
    tailwind({ applyBaseStyles: false })
  ]
});
