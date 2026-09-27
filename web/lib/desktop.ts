/**
 * Side-panel layout starts at this width; the bottom sheet is below it.
 * Same text as `--breakpoint-md` in app/globals.css.
 * Pixels, not rem: 64rem is 1024px only at a 16px root. A smaller browser
 * default font would pull the side panel down into 768–1023px.
 */
export const DESKTOP_MIN_WIDTH = "1024px";

export const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH})`;
