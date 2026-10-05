import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "@/components/LoginForm";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <AuthShell title="Log in">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
