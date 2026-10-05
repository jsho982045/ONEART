/**
 * The canvas is a square of WORLD_SIZE x WORLD_SIZE "world units".
 * KEEP IN SYNC with the CHECK constraints and place_splat() bounds in
 * supabase/migrations/*_init.sql.
 */
export const WORLD_SIZE = 5000;

/** Highest zoom: 1 world unit = MAX_ZOOM screen pixels. */
export const MAX_ZOOM = 4;

/**
 * Most splats the viewer will pull for one viewport. v1 has no tile pyramid,
 * so very large canvases zoomed all the way out will show a partial view.
 * See README "Known limits".
 */
export const MAX_LOAD = 10000;
