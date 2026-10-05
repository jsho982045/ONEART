import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { SignupForm } from "@/components/SignupForm";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage() {
  return (
    <AuthShell title="Make your account" intro="One account, one click. You can look around the canvas without one.">
      <SignupForm />
    </AuthShell>
  );
}
