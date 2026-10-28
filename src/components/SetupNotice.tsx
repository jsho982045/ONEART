export function SetupNotice() {
  return (
    <div className="mx-auto mt-24 max-w-[56ch] px-6">
      <h1 className="text-3xl font-display font-normal tracking-[-0.005em]">Connect Supabase to get started</h1>
      <p className="mt-4 text-[17px] leading-relaxed text-graphite">
        This app can&apos;t reach its database yet. Copy <code>.env.local.example</code> to{" "}
        <code>.env.local</code>, fill in the project URL and anon key from your dev Supabase project, then restart
        <code> npm run dev</code>.
      </p>
      <p className="mt-3 text-[17px] leading-relaxed text-graphite">
        The README walks through creating the project and applying the migration.
      </p>
    </div>
  );
}
