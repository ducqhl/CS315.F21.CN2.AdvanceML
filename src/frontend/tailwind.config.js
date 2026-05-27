/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-void':     '#02040C',
        'bg-primary':  '#060913',
        'bg-card':     '#0A0F1E',
        'bg-card-hover': '#0D1326',
        'bg-elevated': '#111927',
        'border-dim':  '#131B2A',
        border:        '#1C2840',
        'border-bright': '#243359',
        cyan:          '#00E5FF',
        'cyan-20':     'rgba(0,229,255,0.20)',
        'cyan-10':     'rgba(0,229,255,0.10)',
        'cyan-05':     'rgba(0,229,255,0.05)',
        green:         '#00F0A0',
        'green-10':    'rgba(0,240,160,0.10)',
        red:           '#FF3864',
        'red-10':      'rgba(255,56,100,0.10)',
        gold:          '#FFB020',
        'gold-10':     'rgba(255,176,32,0.10)',
        violet:        '#8B5CF6',
        'violet-10':   'rgba(139,92,246,0.10)',
        'text-primary':   '#D0DDF5',
        'text-secondary': '#556070',
        'text-muted':     '#2A3545',
        'text-accent':    '#00E5FF',
      },
      fontFamily: {
        display: ['Orbitron', 'sans-serif'],
        mono:    ['Space Mono', 'monospace'],
        body:    ['Manrope', 'system-ui', 'sans-serif'],
      },
      animation: {
        'ticker':   'ticker 40s linear infinite',
        'fade-in':  'fadeIn 0.2s ease',
        'slide-up': 'slideUp 0.25s ease',
        'pulse-slow': 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
      },
      keyframes: {
        ticker: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      transitionProperty: {
        'width': 'width',
      },
    },
  },
  plugins: [],
}
