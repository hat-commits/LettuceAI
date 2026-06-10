import { invoke } from "@tauri-apps/api/core";
import type { ProviderCredential } from "../storage/schemas";

export const LOCAL_DIFFUSION_PROVIDER_ID = "localdiffusion";
export const LOCAL_DIFFUSION_PROVIDER_LABEL = "Local Diffusion";

export const LOCAL_DIFFUSION_CREDENTIAL: ProviderCredential = {
  id: "builtin-localdiffusion",
  providerId: LOCAL_DIFFUSION_PROVIDER_ID,
  label: LOCAL_DIFFUSION_PROVIDER_LABEL,
};

export type SdFamily = string;

export type SdModelRole =
  | "checkpoint"
  | "diffusionModel"
  | "clipL"
  | "clipG"
  | "t5xxl"
  | "llm"
  | "llmVision"
  | "vae";

export interface SdModelFiles {
  checkpoint?: string | null;
  diffusionModel?: string | null;
  clipL?: string | null;
  clipG?: string | null;
  t5xxl?: string | null;
  llm?: string | null;
  llmVision?: string | null;
  vae?: string | null;
}

export interface SdMeasuredProfile {
  totalParamsMb: number;
  textEncodersMb: number;
  diffusionMb: number;
  vaeMb: number;
  maxComputeVramMb: number;
  width: number;
  height: number;
}

export interface SdModelEntry {
  id: string;
  name: string;
  family: SdFamily;
  files: SdModelFiles;
  source: string;
  repo?: string | null;
  totalBytes: number;
  createdAt: number;
  complete: boolean;
  measured?: SdMeasuredProfile | null;
}

export interface SdBinaryInfo {
  path: string;
  variant: string;
  releaseTag: string;
}

export interface SdStatus {
  binary: SdBinaryInfo | null;
  recommendedVariant: string;
  modelsDir: string;
}

export interface SdEngineVariant {
  id: string;
  assetName: string;
  size: number;
  releaseTag: string;
  recommended: boolean;
}

export interface SdQueuedInstall {
  installId: string;
  queueIds: string[];
}

export async function sdGetStatus(): Promise<SdStatus> {
  return invoke<SdStatus>("sd_get_status");
}

export async function sdListModels(): Promise<SdModelEntry[]> {
  return invoke<SdModelEntry[]>("sd_list_models");
}

export async function sdImportModel(
  name: string,
  files: SdModelFiles,
  family?: string | null,
): Promise<SdModelEntry> {
  return invoke<SdModelEntry>("sd_import_model", { name, family: family ?? null, files });
}

export async function sdUpdateModelFiles(
  modelId: string,
  files: SdModelFiles,
): Promise<SdModelEntry> {
  return invoke<SdModelEntry>("sd_update_model_files", { modelId, files });
}

export interface SdLocalFile {
  filename: string;
  path: string;
  size: number;
}

export async function sdListLocalFiles(): Promise<SdLocalFile[]> {
  return invoke<SdLocalFile[]>("sd_list_local_files");
}

export async function sdSetModelFile(
  modelId: string,
  role: SdModelRole,
  path: string | null,
): Promise<SdModelEntry> {
  return invoke<SdModelEntry>("sd_set_model_file", { modelId, role, path });
}

export async function sdDeleteModel(modelId: string, deleteFiles: boolean): Promise<boolean> {
  return invoke<boolean>("sd_delete_model", { modelId, deleteFiles });
}

export async function sdListEngineVariants(): Promise<SdEngineVariant[]> {
  return invoke<SdEngineVariant[]>("sd_list_engine_variants");
}

export async function sdQueueBinaryInstall(variant?: string | null): Promise<SdQueuedInstall> {
  return invoke<SdQueuedInstall>("sd_queue_binary_install", { variant: variant ?? null });
}

export async function sdFinalizeBinaryInstall(): Promise<SdBinaryInfo> {
  return invoke<SdBinaryInfo>("sd_finalize_binary_install");
}

export async function sdRemoveBinary(): Promise<void> {
  return invoke<void>("sd_remove_binary");
}

export async function sdCancelGeneration(): Promise<boolean> {
  return invoke<boolean>("sd_cancel_generation");
}

export async function sdRegisterHfModel(
  repo: string,
  filePath: string,
  role: SdModelRole,
  family?: string | null,
  displayName?: string | null,
): Promise<SdModelEntry> {
  return invoke<SdModelEntry>("sd_register_hf_model", {
    repo,
    filePath,
    role,
    family: family ?? null,
    displayName: displayName ?? null,
  });
}

export async function sdEnsureModelRow(entry: SdModelEntry): Promise<void> {
  if (!entry.complete) return;
  const { addOrUpdateModel, readSettings } = await import("../storage/repo");
  const settings = await readSettings();
  const existing = settings.models.find(
    (model) => model.providerId === LOCAL_DIFFUSION_PROVIDER_ID && model.name === entry.id,
  );
  await addOrUpdateModel({
    id: existing?.id,
    name: entry.id,
    providerId: LOCAL_DIFFUSION_PROVIDER_ID,
    providerLabel: LOCAL_DIFFUSION_PROVIDER_LABEL,
    displayName: entry.name,
    inputScopes: ["text", "image"],
    outputScopes: ["image"],
  });
}

export async function sdRemoveModelRow(entryId: string): Promise<void> {
  const { readSettings, removeModel } = await import("../storage/repo");
  const settings = await readSettings();
  const existing = settings.models.find(
    (model) => model.providerId === LOCAL_DIFFUSION_PROVIDER_ID && model.name === entryId,
  );
  if (existing) {
    await removeModel(existing.id);
  }
}
