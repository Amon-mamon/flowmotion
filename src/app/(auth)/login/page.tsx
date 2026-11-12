import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/features/auth/components/login-form";
import { LoginNotice } from "@/features/auth/components/login-notice";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Log in</h1>
      <Suspense fallback={null}>
        <LoginNotice />
      </Suspense>
      <LoginForm />
    </>
  );
}
