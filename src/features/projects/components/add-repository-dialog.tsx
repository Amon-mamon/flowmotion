"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RepoPicker, type RepoPickerStep } from "@/features/github/components/repo-picker";

/** exact (design.md "Add repository dialog") */
const STEP_COPY: Readonly<Record<RepoPickerStep, { title: string; description: string }>> = {
  repo: {
    title: "Choose a repository",
    description: "Pick a repository from a connected GitHub installation. Flow Motion only reads it.",
  },
  branch: {
    title: "Choose a branch",
    description:
      "Flow Motion analyzes the latest commit on this branch. To use a different branch later, add the repository again.",
  },
};

export function AddRepositoryDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<RepoPickerStep>("repo");

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setStep("repo");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button />}>
        <PlusIcon aria-hidden="true" />
        Add repository
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{STEP_COPY[step].title}</DialogTitle>
          <DialogDescription>{STEP_COPY[step].description}</DialogDescription>
        </DialogHeader>
        {open ? (
          <RepoPicker
            onStepChange={setStep}
            onCreated={(project) => {
              onOpenChange(false);
              router.push(`/projects/${encodeURIComponent(project.id)}`);
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
