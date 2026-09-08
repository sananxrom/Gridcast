'use client';
import { SignIn, Shell, PlatformBadge } from '@/components/views/auth';
import { TopProgress } from '@/components/ui/loader';

/** Unlisted. Nothing in the product links here. */
export default function Control() {
  return (<>
    <TopProgress />
    <Shell>
      <div className="w-full max-w-[400px]">
        <SignIn role="platform" title="Platform console"
          sub="Gridcast network administration."
          tabs={<PlatformBadge />} />
      </div>
    </Shell>
  </>);
}
