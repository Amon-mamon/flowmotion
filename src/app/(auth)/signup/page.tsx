import type { Metadata } from "next";

import { SignupForm } from "@/features/auth/components/signup-form";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Create your account</h1>
      <SignupForm />
    </>
  );
}
