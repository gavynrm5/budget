/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"]
      },
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        ink: token("ink"),
        muted: token("muted"),
        line: token("line"),
        primary: token("primary"),
        "on-primary": token("on-primary"),
        good: token("good"),
        warn: token("warn"),
        bad: token("bad")
      },
      zIndex: { nav: "20", fab: "30", sheet: "40", toast: "50" }
    }
  },
  plugins: []
};
