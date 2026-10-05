import { notFound } from "next/navigation";
import { SplatLab } from "./SplatLab";

export const dynamic = "force-dynamic";

/** Developer tool: look at generated splats. Not available in production. */
export default function SplatLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SplatLab />;
}
