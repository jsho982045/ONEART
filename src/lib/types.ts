/** A row of public.splats as the browser sees it. */
export type SplatRow = {
  id: string;
  x: number;
  y: number;
  seed: number;
  algo_version: number;
  created_at: string;
};

/** Result of the public.splat_owner(uuid) RPC. username is null if the owner deleted their account. */
export type SplatOwner = {
  username: string | null;
  created_at: string;
};

/** Result of the public.my_state() RPC. null when logged out. */
export type MyState = {
  user_id: string;
  username: string;
  onboarded: boolean;
  has_clicked: boolean;
  email_verified: boolean;
  splat: SplatRow | null;
} | null;

export type CanvasMeta = {
  total_clicks: number;
  status: "active" | "closed" | "sold";
  closes_at: string | null;
  max_splats: number | null;
};
