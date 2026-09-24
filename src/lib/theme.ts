export type ThemePref = "system" | "light" | "dark";

export function getTheme(): ThemePref {
  try {
    return (localStorage.getItem("theme") as ThemePref) || "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0A0A0A" : "#F7F6F4");
}

export function setTheme(pref: ThemePref) {
  try {
    localStorage.setItem("theme", pref);
  } catch {
    /* private mode */
  }
  applyTheme(pref);
}

export function watchSystemTheme() {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const on = () => getTheme() === "system" && applyTheme("system");
  mq.addEventListener("change", on);
  applyTheme(getTheme());
  return () => mq.removeEventListener("change", on);
}
