/** Zoom and locate need about this much map above the sheet. */
export const MAP_CONTROLS_CLEARANCE = 170;

/**
 * A shorter strip slides the controls under the header while they can still take focus
 * (WCAG 2.4.11). Desktop uses the side panel, so the strip is the full stage.
 */
export function mapControlsHidden(desktop: boolean, stageHeight: number, sheetHeight: number) {
  return !desktop && stageHeight - sheetHeight < MAP_CONTROLS_CLEARANCE;
}
