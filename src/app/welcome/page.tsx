import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { SetupNotice } from "@/components/SetupNotice";
import { WelcomeForm } from "@/components/WelcomeForm";
import { safeNext } from "@/lib/safe-next";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Finish setting up" };
export const dynamic = "force-dynamic";

export default async function WelcomePage({ searchParams }: { searchParams: { next?: string } }) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const next = safeNext(searchParams.next);
  const supabase = createSupabaseServer();
  const { data: state } = await supabase.rpc("my_state");

  if (!state) redirect(`/login?next=${encodeURIComponent("/welcome")}`);
  if (state.onboarded) redirect(next);

  return (
    <AuthShell
      title="One more step"
      intro="Choose the name that signs your work and confirm the terms. Then pick up a brush."
    >
      <WelcomeForm next={next} />
    </AuthShell>
  );
}
