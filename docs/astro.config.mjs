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
          entryPoints: ['../src/middlewares/index.ts', '../src/client.ts', '../src/server.ts',],
          tsconfig: '../tsconfig.json',
          pagination: true,
          typeDoc: {
            entryPointStrategy: 'resolve',
            excludeInternal: true,
            excludePrivate: true,
            excludeProtected: true,
            githubPages: false,
            readme: 'none',
            theme: 'starlight-typedoc',
          }
          // watch: true,
        })
      ]
    }),
    tailwind({ applyBaseStyles: false })
  ]
});
