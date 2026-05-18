/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Otter primary — teal/cyan (aquatic, the otter's element)
        otter: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
          950: '#083344'
        },
        // Fur — warm brown for accents (otter's coat)
        fur: {
          50: '#fdf8f3',
          100: '#f4e8d8',
          200: '#e8d0ad',
          300: '#d4ad7b',
          400: '#bb854c',
          500: '#a87340',
          600: '#8d5d33',
          700: '#6e4827',
          800: '#4a311b',
          900: '#2d1d10'
        },
        // Deep ocean — backgrounds
        deep: {
          900: '#0a1628',
          950: '#050a14'
        }
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'system-ui',
          'sans-serif'
        ],
        display: ['Inter', 'system-ui', 'sans-serif']
      },
      backdropBlur: {
        xs: '2px',
        '3xl': '40px'
      },
      boxShadow: {
        'glass-sm': '0 2px 8px 0 rgba(8, 51, 68, 0.25), inset 0 1px 0 0 rgba(255,255,255,0.08)',
        glass:
          '0 8px 32px 0 rgba(8, 51, 68, 0.35), inset 0 1px 0 0 rgba(255,255,255,0.10)',
        'glass-lg':
          '0 24px 64px -12px rgba(8, 51, 68, 0.5), inset 0 1px 0 0 rgba(255,255,255,0.12)',
        'glow-otter': '0 0 24px 0 rgba(34, 211, 238, 0.45)',
        'glow-otter-lg': '0 0 64px 0 rgba(34, 211, 238, 0.35)',
        'glow-fur': '0 0 24px 0 rgba(187, 133, 76, 0.45)',
        'glow-red': '0 0 24px 0 rgba(239, 68, 68, 0.55)'
      },
      animation: {
        'orb-float-1': 'orbFloat1 22s ease-in-out infinite',
        'orb-float-2': 'orbFloat2 28s ease-in-out infinite',
        'orb-float-3': 'orbFloat3 32s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2.5s ease-in-out infinite',
        'fade-in-up': 'fadeInUp 0.4s ease-out'
      },
      keyframes: {
        orbFloat1: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(80px, -60px) scale(1.1)' },
          '66%': { transform: 'translate(-40px, 80px) scale(0.95)' }
        },
        orbFloat2: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(-100px, 60px) scale(1.15)' }
        },
        orbFloat3: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '25%': { transform: 'translate(60px, 40px) scale(0.9)' },
          '75%': { transform: 'translate(-50px, -70px) scale(1.05)' }
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.7', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.05)' }
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        }
      }
    }
  },
  plugins: []
}
