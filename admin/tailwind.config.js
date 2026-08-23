/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Triumph 莫兰迪灰粉品牌色
        brand: {
          DEFAULT: '#C09D9B',
          dark: '#A67D7A',
          ink: '#3A3532',
          soft: '#6E6760',
        },
      },
    },
  },
  plugins: [],
};
