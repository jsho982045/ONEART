import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export async function SiteHeader({ overlay = false }: { overlay?: boolean }) {
  let loggedIn = false;
  if (isSupabaseConfigured) {
    const supabase = createSupabaseServer();
    const { data } = await supabase.auth.getUser();
    loggedIn = Boolean(data.user);
  }

  return (
    <header
      className={`flex items-center justify-between px-5 py-4 sm:px-8 ${
        overlay ? "absolute inset-x-0 top-0 z-20" : ""
      }`}
    >
      <Link href="/" className="text-[22px] font-bold leading-none tracking-[-0.04em]">
        oneart
      </Link>
      <nav className="flex items-center gap-5 text-[15px] font-medium">
        <Link href="/canvas" className="text-link">
          Canvas
        </Link>
        {loggedIn ? (
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-link">
              Log out
            </button>
          </form>
        ) : (
          <>
            <Link href="/login" className="text-link">
              Log in
            </Link>
            <Link href="/signup" className="btn btn-primary btn-small">
              Sign up
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
