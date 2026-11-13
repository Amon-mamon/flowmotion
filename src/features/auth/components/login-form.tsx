"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { loginErrorMessage } from "@/features/auth/error-messages";
import { loginSchema, type LoginValues } from "@/features/auth/schemas";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      setFormError("Sign-in is not available right now. Try again later.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    if (error) {
      // Generic on purpose (docs/contract.md Phase 1 scope); only a rate limit gets its own copy.
      setFormError(loginErrorMessage(error));
      return;
    }
    setSignedIn(true);
    router.push("/dashboard");
    router.refresh();
  }

  const busy = isSubmitting || signedIn;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input
          type="email"
          autoComplete="email"
          disabled={busy}
          {...fieldAria("email", errors.email?.message)}
          {...register("email")}
        />
      </FormField>
      <FormField id="password" label="Password" error={errors.password?.message}>
        <Input
          type="password"
          autoComplete="current-password"
          disabled={busy}
          {...fieldAria("password", errors.password?.message)}
          {...register("password")}
        />
      </FormField>

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      {signedIn ? (
        <Alert>
          <CheckCircle2Icon aria-hidden="true" />
          <AlertDescription>Signed in. Taking you to your dashboard.</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="lg" disabled={busy}>
        {isSubmitting ? "Logging in…" : "Log in"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
          Sign up
        </Link>
      </p>
    </form>
  );
}
