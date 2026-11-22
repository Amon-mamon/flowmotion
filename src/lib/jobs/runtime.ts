import { createAnthropicModel } from "@/lib/analysis/model/anthropic";
import { resolveModelConfig, type ModelEnvSource, type ModelRunner } from "@/lib/analysis/model/config";
import { createOpenRouterModel } from "@/lib/analysis/model/openrouter";
import type { AnalysisModel } from "@/lib/analysis/model/types";
import {
  fetchRepoTreeBlobs,
  getBlobBytes,
  getBranchHeadSha,
  getInstallationRepo,
} from "@/lib/github/client";
import { GitHubApiError } from "@/lib/github/errors";
import type { FetchLike } from "@/lib/github/http";
import { createInstallationToken } from "@/lib/github/installation-token";
import type { WorkerGitHub } from "@/lib/jobs/types";

/**
 * Production adapters for the worker deps (runtime-neutral: fetch + Web
 * Crypto only). Shared by the Deno Edge Function and the local dev runner.
 */

export interface WorkerGitHubConfig {
  appId: string;
  privateKeyPem: string;
  fetch?: FetchLike;
}

export function createWorkerGitHub(config: WorkerGitHubConfig): WorkerGitHub {
  const withFetch = (token: string) => ({ token, ...(config.fetch !== undefined ? { fetch: config.fetch } : {}) });
  return {
    async mintToken(installationId: number): Promise<string> {
      const minted = await createInstallationToken({
        appId: config.appId,
        privateKeyPem: config.privateKeyPem,
        installationId,
        ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
      });
      return minted.token;
    },
    getBranchHeadSha: (token, fullName, branch) => getBranchHeadSha(withFetch(token), fullName, branch),
    async getRepoId(token, fullName) {
      const repo = await getInstallationRepo(withFetch(token), fullName);
      return repo === null ? null : repo.id;
    },
    async isRepoReadable(token, fullName) {
      try {
        return (await getInstallationRepo(withFetch(token), fullName)) !== null;
      } catch (error) {
        if (error instanceof GitHubApiError && (error.status === 401 || error.status === 403)) return false;
        throw error;
      }
    },
    async getTreeBlobs(token, fullName, sha) {
      const tree = await fetchRepoTreeBlobs(withFetch(token), fullName, sha);
      return { blobs: tree.blobs, truncated: tree.truncated };
    },
    getBlob: (token, fullName, sha) => getBlobBytes(withFetch(token), fullName, sha),
  };
}

/**
 * The analysis model, or null while AI is off or refused (D-16, D-24, D-33).
 * This is the only provider switch. `runner` is required: the local runner
 * passes "local", the worker Edge Function passes "edge" (which refuses
 * OpenRouter inside `resolveModelConfig`, so no adapter is ever built).
 */
export function createModelFromEnv(env: ModelEnvSource, runner: ModelRunner, fetch?: FetchLike): AnalysisModel | null {
  const config = resolveModelConfig(env, runner);
  if (!config.enabled) return null;
  const options = { apiKey: config.apiKey, model: config.model, ...(fetch !== undefined ? { fetch } : {}) };
  switch (config.provider) {
    case "anthropic":
      return createAnthropicModel(options);
    case "openrouter":
      return createOpenRouterModel(options);
  }
}
