/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./client/index.html",
        "./client/src/**/*.{js,ts,jsx,tsx}", // Scan client source files
    ],
    theme: {
        extend: {
        // Glassmorphism Example (adjust as needed)
        backgroundColor: theme => ({
            ...theme('colors'), // Inherit default colors
            'glass': 'rgba(255, 255, 255, 0.1)', // Semi-transparent white
        }),
        backdropBlur: {
            'glass': '10px', // Blur effect
        },
        borderColor: theme => ({
            ...theme('colors'),
            'glass': 'rgba(255, 255, 255, 0.2)', // Subtle border
        })
        },
    },
    plugins: [],
}