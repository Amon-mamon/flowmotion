"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheckIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { signupSchema, type SignupValues } from "@/features/auth/schemas";
import { createClient } from "@/lib/supabase/client";

type Outcome = "idle" | "session" | "confirm-email";

export function SignupForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "", displayName: "" },
  });

  async function onSubmit(values: SignupValues) {
    setFormError(null);
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      setFormError("Sign-up is not available right now. Try again later.");
      return;
    }
    const displayName = values.displayName.trim();
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
        data: displayName.length > 0 ? { display_name: displayName } : undefined,
      },
    });
    if (error) {
      setFormError("Could not create your account. Check your details and try again.");
      return;
    }
    if (data.session) {
      setOutcome("session");
      router.push("/dashboard");
      router.refresh();
      return;
    }
    setOutcome("confirm-email");
  }

  if (outcome === "confirm-email") {
    return (
      <Alert role="status">
        <MailCheckIcon aria-hidden="true" />
        <AlertTitle>Check your email to confirm your account</AlertTitle>
        <AlertDescription>
          We sent a confirmation link. After you open it you will land on your dashboard.
        </AlertDescription>
      </Alert>
    );
  }

  const busy = isSubmitting || outcome === "session";

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
      <FormField
        id="password"
        label="Password"
        hint="At least 8 characters."
        error={errors.password?.message}
      >
        <Input
          type="password"
          autoComplete="new-password"
          disabled={busy}
          {...fieldAria("password", errors.password?.message, "At least 8 characters.")}
          {...register("password")}
        />
      </FormField>
      <FormField
        id="displayName"
        label="Display name (optional)"
        error={errors.displayName?.message}
      >
        <Input
          type="text"
          autoComplete="name"
          maxLength={80}
          disabled={busy}
          {...fieldAria("displayName", errors.displayName?.message)}
          {...register("displayName")}
        />
      </FormField>

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      {outcome === "session" ? (
        <Alert role="status">
          <AlertDescription>Account created. Taking you to your dashboard.</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="lg" disabled={busy}>
        {isSubmitting ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
