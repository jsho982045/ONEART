import type { Metadata } from "next";
import { AdminConsole } from "@/components/AdminConsole";

export const metadata: Metadata = { title: "Moderation", robots: { index: false, follow: false } };

export default function AdminPage() {
  return <AdminConsole />;
}
