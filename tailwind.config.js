/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './src/**/*.html'],
  corePlugins: {},
  theme: {
    extend: {
      zIndex: {
        1000: '1000',
        2000: '2000',
      },
    },
  },
  plugins: [],

  // jeśli gra używa inline styles
  // important: true,
};
