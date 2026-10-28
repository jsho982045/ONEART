import { SiteHeader } from "@/components/SiteHeader";

/** Shared frame for the signup / login / reset pages. */
export function AuthShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[28rem] px-5 pb-20 pt-10 sm:pt-16">
        <h1 className="text-[clamp(1.9rem,5vw,2.5rem)] font-display font-normal leading-[1.02] tracking-[-0.005em]">{title}</h1>
        {intro && <p className="mt-3 text-[17px] leading-[1.5] text-graphite">{intro}</p>}
        <div className="mt-8">{children}</div>
      </main>
    </>
  );
}
