/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // -----------------------------------------------------------------
        // Otterwise — palette signature (otter-morphism)
        // Liquid Glass + Clay Morphism + Aqua + Loutre.
        // Spec : C:\Users\maill\Documents\Agents\skills\otter-morphism.skill.md
        // -----------------------------------------------------------------
        sea: {
          50: '#E8F4F8',  // glacier
          100: '#D6EBF1',
          200: '#B8E0E8', // aqua-mist
          300: '#8FCAD6',
          400: '#5FAFC1',
          500: '#3D8FA6',
          600: '#2A7290', // mid-sea
          700: '#1B5E7B', // deep-sea (primary)
          800: '#144A62',
          900: '#0D3548',
          950: '#07212F'
        },
        cream: {
          50: '#FBF6EE',
          100: '#F5E6D3', // cream signature (peau loutre)
          200: '#EAD6BA',
          300: '#DEC29F',
          400: '#C89E76', // caramel
          500: '#A98058',
          600: '#876440',
          700: '#634A2F',
          800: '#3D2817', // espresso
          900: '#2A1B0F'
        },
        coral: {
          50: '#FFF1EE',
          100: '#FFE0D9',
          200: '#FFC6B9',
          300: '#FFA796',
          400: '#FF8B7B', // coral pop (CTA principal)
          500: '#F86A57',
          600: '#D94A37',
          700: '#A8362A',
          800: '#7C271F'
        },
        kelp: {
          50: '#EEF5F0',
          100: '#D5E5D9',
          400: '#6E9E7B',
          500: '#4A7C59', // success states / data viz
          600: '#3A6447',
          700: '#2C4D37'
        },
        sunray: {
          400: '#FFD787',
          500: '#FFC857', // warning soft
          600: '#E0A938'
        },

        // -----------------------------------------------------------------
        // OtterMorphisme — accent unique menthe (refonte v0.6, voir
        // document.md). Remplace progressivement le corail comme couleur
        // d'action. 60/30/10 : fond frais / encre / menthe.
        // -----------------------------------------------------------------
        mint: {
          50: '#E8FBF5',
          100: '#C9F4E8',
          200: '#9DEEDA',
          300: '#5FE3C0',
          400: '#2BD9AC', // menthe vive (halos, accent lumineux)
          500: '#19C49E', // menthe dégradé bas
          600: '#0FA587', // menthe profonde (texte, icônes, labels)
          700: '#0B806A',
          900: '#06231C' // texte sur fond menthe
        },

        // -----------------------------------------------------------------
        // Aliases — gardés pour ne pas casser le code existant.
        // À terme, les composants migrent vers sea/cream/coral.
        // -----------------------------------------------------------------
        otter: {
          50: '#E8F4F8',
          100: '#D6EBF1',
          200: '#B8E0E8',
          300: '#8FCAD6',
          400: '#5FAFC1',
          500: '#3D8FA6',
          600: '#2A7290',
          700: '#1B5E7B',
          800: '#144A62',
          900: '#0D3548',
          950: '#07212F'
        },
        fur: {
          50: '#FBF6EE',
          100: '#F5E6D3',
          200: '#EAD6BA',
          300: '#DEC29F',
          400: '#C89E76',
          500: '#A98058',
          600: '#876440',
          700: '#634A2F',
          800: '#3D2817',
          900: '#2A1B0F'
        },
        deep: {
          900: '#0D3548',
          950: '#07212F'
        }
      },
      fontFamily: {
        sans: [
          'Inter',
          'Geist Sans',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'system-ui',
          'sans-serif'
        ],
        display: ['Outfit', 'Geist', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Geist Mono', 'ui-monospace', 'monospace']
      },
      backdropBlur: {
        xs: '2px',
        '3xl': '40px'
      },
      boxShadow: {
        // Glass — soft deep-sea undertones, never harsh
        'glass-sm':
          '0 2px 8px 0 rgba(27, 94, 123, 0.16), inset 0 1px 0 0 rgba(255,255,255,0.40)',
        glass:
          '0 8px 32px 0 rgba(27, 94, 123, 0.20), inset 0 1px 0 0 rgba(255,255,255,0.50)',
        'glass-lg':
          '0 24px 64px -12px rgba(27, 94, 123, 0.32), inset 0 1px 0 0 rgba(255,255,255,0.55)',
        // Clay — soft 3D, two-shadow stack
        clay:
          '8px 8px 20px rgba(61, 40, 23, 0.16), -6px -6px 16px rgba(255, 255, 255, 0.85), inset 0 2px 4px rgba(255, 255, 255, 0.55)',
        'clay-sm':
          '4px 4px 12px rgba(61, 40, 23, 0.14), -3px -3px 8px rgba(255, 255, 255, 0.80), inset 0 1px 2px rgba(255, 255, 255, 0.50)',
        'clay-pressed':
          'inset 4px 4px 10px rgba(61, 40, 23, 0.20), inset -3px -3px 8px rgba(255, 255, 255, 0.65)',
        // Glows
        'glow-coral': '0 0 32px 0 rgba(255, 139, 123, 0.45)',
        'glow-coral-lg': '0 0 64px 0 rgba(255, 139, 123, 0.35)',
        // Menthe — accent OtterMorphisme (refonte v0.6)
        'glow-mint': '0 0 32px 0 rgba(43, 217, 172, 0.45)',
        'glow-mint-lg': '0 0 64px 0 rgba(43, 217, 172, 0.35)',
        'glow-aqua': '0 0 32px 0 rgba(184, 224, 232, 0.55)',
        'glow-aqua-lg': '0 0 64px 0 rgba(184, 224, 232, 0.45)',
        'glow-cream': '0 0 24px 0 rgba(245, 230, 211, 0.55)',
        'glow-otter': '0 0 24px 0 rgba(184, 224, 232, 0.45)',
        'glow-otter-lg': '0 0 64px 0 rgba(184, 224, 232, 0.35)',
        'glow-red': '0 0 24px 0 rgba(255, 139, 123, 0.55)'
      },
      borderRadius: {
        otter: '24px',
        clay: '28px'
      },
      animation: {
        'orb-float-1': 'orbFloat1 22s ease-in-out infinite',
        'orb-float-2': 'orbFloat2 28s ease-in-out infinite',
        'orb-float-3': 'orbFloat3 32s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2.5s ease-in-out infinite',
        'fade-in-up': 'fadeInUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        bubble: 'bubble 4s ease-in-out infinite',
        'bubble-slow': 'bubble 6s ease-in-out infinite',
        sheen: 'sheen 6s ease-in-out infinite'
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
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        bubble: {
          '0%, 100%': { transform: 'translateY(0) scale(1)' },
          '50%': { transform: 'translateY(-12px) scale(1.03)' }
        },
        sheen: {
          '0%, 100%': { backgroundPosition: '0% 0%' },
          '50%': { backgroundPosition: '100% 100%' }
        }
      }
    }
  },
  plugins: []
}
