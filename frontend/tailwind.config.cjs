module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      keyframes: {
        'ping-pong': {
          '0%, 100%': { transform: 'translateX(0)' },
          '50%': { transform: 'translateX(200%)' },
        }
      },
      animation: {
        'ping-pong': 'ping-pong 1.5s ease-in-out infinite',
      }
    },
  },
  plugins: [],
}
