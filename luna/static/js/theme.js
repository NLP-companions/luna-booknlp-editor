'use strict';
/* Applies a saved light/dark override before the page paints, so there's no flash of the wrong theme.
   Loaded first (in <head>, before the stylesheet) on every page. Setting is 'bne.theme' in localStorage:
   'light' or 'dark' forces that theme; anything else (including unset) follows the OS (see app.css).
   Also the one place the setting is read and written, for the editor's [...] menu and the Settings page. */

/* The saved theme: 'light' or 'dark' force it, 'auto' (the default) follows the OS. Browser-only, not synced anywhere. */
function getTheme() {
  try { const v = localStorage.getItem('bne.theme'); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; }
}
/* Show the saved theme as the pressed button in every Auto/Light/Dark group (class 'themeseg') on the page. */
function markTheme() {
  document.querySelectorAll('.themeseg [data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === getTheme())));
}
/* Set the theme, apply it at once (this file otherwise only runs on page load) and remember it. */
function setTheme(v) {
  try { if (v === 'auto') localStorage.removeItem('bne.theme'); else localStorage.setItem('bne.theme', v); } catch { }
  if (v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
  markTheme();
}
if (getTheme() !== 'auto') document.documentElement.dataset.theme = getTheme();
