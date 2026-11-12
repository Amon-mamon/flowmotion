"use client";

import { PlusIcon } from "lucide-react";
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
import { RepoPicker } from "@/features/github/components/repo-picker";

export function AddRepositoryDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon aria-hidden="true" />
        Add repository
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add repository</DialogTitle>
          <DialogDescription>
            Pick a repository from a connected GitHub installation. Flow Motion only reads it.
          </DialogDescription>
        </DialogHeader>
        {open ? <RepoPicker onCreated={() => setOpen(false)} onCancel={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
