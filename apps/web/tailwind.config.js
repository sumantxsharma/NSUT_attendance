/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: { DEFAULT: '#1B2A41', 900: '#111C2E', 800: '#15233A', 700: '#1B2A41', 600: '#2B3D59', 500: '#44587A' },
        brand: { DEFAULT: '#1F4E8C', 50: '#EEF3FA', 100: '#DCE6F4', 600: '#1F4E8C', 700: '#183F72', 800: '#12325B' },
        canvas: '#F5F6F8',
        line: '#DDE1E7',
        muted: '#5B6472',
        st: {
          present: '#1D7A46', presentBg: '#E8F4ED',
          live: '#1F5FB8', liveBg: '#E7EFFA',
          leave: '#8A5A00', leaveBg: '#FBF1DC',
          absent: '#B3261E', absentBg: '#FBE9E8',
          none: '#5B6472', noneBg: '#EEF0F3',
          half: '#6B3FA0', halfBg: '#F1EBF8',
          holiday: '#3F5566', holidayBg: '#E9EEF2',
        },
      },
      borderRadius: { DEFAULT: '4px', md: '6px' },
      fontSize: { '2xs': ['11px', '14px'] },
    },
  },
  plugins: [],
};
