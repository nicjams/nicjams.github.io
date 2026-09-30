/* ------------------------------------------------------------------ *
 *  Penrose — entry point. Wires state, rendering, UI, interaction,
 *  motion, and the acceptance-window inset.
 * ------------------------------------------------------------------ */

import { state, schedule, gammaChanged } from './state.js';
import { initRender, getCanvas, pick } from './render.js';
import { initUI } from './ui.js';
import { initInteraction } from './interaction.js';
import { initInset, phasonShift } from './inset.js';
import { reanchor } from './motion.js';

initUI();
initRender();
initInteraction(getCanvas(), pick);
initInset((dx, dy) => {
    phasonShift(dx, dy);
    reanchor();
    gammaChanged();
});
schedule();

// Handy for debugging and for driving the page from the console.
window.penrose = { state, schedule };
