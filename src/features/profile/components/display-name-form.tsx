"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { FormField, fieldAria } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeError } from "@/features/api/client";
import { useUpdateDisplayName } from "@/features/profile/queries";
import { displayNameFormSchema, type DisplayNameFormValues } from "@/features/profile/schemas";
import type { Profile } from "@/features/profile/schemas";

export function DisplayNameForm({ profile }: { profile: Profile }) {
  const update = useUpdateDisplayName();
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<DisplayNameFormValues>({
    resolver: zodResolver(displayNameFormSchema),
    defaultValues: { displayName: profile.displayName ?? "" },
  });

  function onSubmit(values: DisplayNameFormValues) {
    update.mutate(values.displayName);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex max-w-md flex-col gap-4">
      <FormField
        id="displayName"
        label="Display name"
        hint="Shown in the sidebar. 1 to 80 characters."
        error={errors.displayName?.message}
      >
        <Input
          type="text"
          autoComplete="name"
          maxLength={80}
          {...fieldAria("displayName", errors.displayName?.message, "Shown in the sidebar. 1 to 80 characters.")}
          {...register("displayName")}
        />
      </FormField>
      <p className="text-sm text-muted-foreground">
        Email: <span className="text-foreground">{profile.email}</span>
      </p>
      {update.isError ? (
        <p role="alert" className="text-sm text-primary">
          {describeError(update.error)}
        </p>
      ) : null}
      {update.isSuccess ? (
        <p role="status" className="text-sm text-muted-foreground">
          Display name saved.
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={update.isPending || !isDirty}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
