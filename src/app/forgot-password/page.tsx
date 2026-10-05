import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset your password" intro="Enter your email and we'll send you a link to choose a new one.">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
