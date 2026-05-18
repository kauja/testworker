import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0b0d10',
          subtle: '#111418',
          panel: '#15191f',
        },
        line: '#222831',
        ink: {
          DEFAULT: '#e6eaf0',
          muted: '#8d96a3',
          faint: '#5b6472',
        },
        accent: {
          DEFAULT: '#7c9cff',
          soft: '#3a4a7a',
        },
        ok: '#5cd6a6',
        warn: '#f7c873',
        bad: '#ff7a8a',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Inter',
          'Hiragino Kaku Gothic ProN',
          'Noto Sans JP',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
