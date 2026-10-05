import { colors, mediaColors, breakpoints } from './src/tokens/design-tokens.js'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    screens: {
      sm: `${breakpoints.tablet}px`,
      md: `${breakpoints.ipad}px`,
      lg: `${breakpoints.desktop}px`,
    },
    extend: {
      colors: {
        text: colors.textPrimary,
        'text-secondary': colors.textSecondary,
        surface: colors.background,
        'surface-muted': colors.backgroundMuted,
        border: colors.border,
        brand: colors.brandBlue,
        'brand-red': colors.brandRed,
        status: {
          grey: colors.statusGrey,
          amber: colors.statusAmber,
          red: colors.statusRed,
          green: colors.statusGreen,
        },
        media: {
          os2: mediaColors.os2.stroke,
          'os2-edge': mediaColors.os2.edge,
          om4: mediaColors.om4.stroke,
          cat6a: mediaColors.cat6a.stroke,
          stack: mediaColors.stack.stroke,
          dac: mediaColors.dac.stroke,
          power: mediaColors.power.stroke,
          planned: mediaColors.planned.stroke,
        },
      },
      // h-touch / w-touch are the 44px phone touch-target size. They need the
      // height and width scales; min-* alone does not make h-touch produce a height.
      height: {
        touch: '44px',
      },
      width: {
        touch: '44px',
      },
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
    },
  },
  plugins: [],
}
