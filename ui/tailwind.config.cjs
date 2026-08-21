
module.exports = {
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Poppins', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
            },
            colors: {

                // Orange → rouge, calé sur le dégradé des séparateurs de posts
                // (PostCard : #dc2626 → #ef4444 → #f97316). Les boutons
                // `from-topv-400 to-topv-500` deviennent orange→rouge, les
                // mentions/# `text-topv-600` rouges (clair) / `-300` orange (sombre).
                topv: {
                    DEFAULT: '#f97316',
                    50: '#fff4ed',
                    100: '#ffe6d5',
                    200: '#feccaa',
                    300: '#fdac74',
                    400: '#f97316',
                    500: '#ef4444',
                    600: '#dc2626',
                    700: '#b91c1c',
                },

                paper: '#f8f2e4',
                'paper-2': '#efe6cf',
                ink: '#0d0b07',
                'ink-2': '#17130b',
            },
        },
    },
    plugins: [],
}
