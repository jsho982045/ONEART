import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  if (isSupabaseConfigured) {
    const supabase = createSupabaseServer();
    const { data } = await supabase.auth.getUser();
    if (!data.user) redirect("/login?error=link");
  }
  return (
    <AuthShell title="Choose a new password">
      <ResetPasswordForm />
    </AuthShell>
  );
}
