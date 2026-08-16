import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  entry: [
    'src/main.tsx',
    'src/**/*.test.{ts,tsx}',
    'src/**/__tests__/**/*.{ts,tsx}',
  ],
  ignore: [
    'src/assets/logo.tsx',
    'src/i18n/static-keys.ts',
    'src/components/ai-elements/{actions,artifact,branch,canvas,chain-of-thought,confirmation,connection,context,controls,edge,image,inline-citation,node,open-in-chat,panel,plan,queue,suggestion,task,tool,toolbar,web-preview}.tsx',
    'src/components/layout/components/**',
    'src/components/layout/constants.ts',
    'src/components/{auto-skeleton,coming-soon,empty-state,learn-more,theme-quick-switcher}.tsx',
    'src/components/ui/**',
    'src/hooks/use-mobile.tsx',
  ],
  ignoreDependencies: [
    '@tanstack/react-virtual',
    'auto-skeleton-react',
    'next-themes',
    'react-resizable-panels',
    'tokenlens',
    '@xyflow/react',
    'embla-carousel-react',
  ],
}

export default config
