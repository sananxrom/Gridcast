'use client';
import { AuthLayout, SignInForm, BackHome } from '@/components/views/auth';
import { TopProgress } from '@/components/ui/loader';

/** Unlisted. Nothing in the product links here. */
export default function Control() {
  return (<>
    <TopProgress />
    <AuthLayout
      quote="Transparent vertically, isolated horizontally."
      by="Gridcast network rule">
      <BackHome />
      <SignInForm role="platform" platform />
    </AuthLayout>
  </>);
}
