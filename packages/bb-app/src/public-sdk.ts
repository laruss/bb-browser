import {
  PatcherHttpError,
  PatcherRequestTimeoutError,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
  createNodePatcherSdk,
  type PatcherSdk,
  type CreateNodePatcherSdkArgs,
} from "@patcher/sdk/node";
import type {
  PatcherRealtimeSubscribeArgs,
  PatcherRealtimeSocket,
  PatcherRealtimeSocketFactory,
  PatcherRealtimeSocketMessageEvent,
  ThreadGetResult,
  ThreadStatusArgs,
} from "@patcher/sdk/node";

export {
  PatcherHttpError,
  PatcherRequestTimeoutError,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
};
export type * from "@patcher/sdk/node";
export type {
  JsonValue,
  PermissionMode,
  PromptInput,
  PromptTextMention,
  ReasoningLevel,
  ServiceTier,
  ThreadStatus,
} from "@patcher/sdk/node";
export type {
  BaseBranchSpec,
  CreateExecutionInputSources,
  EnvironmentArgs,
  ExistingThreadExecutionInputSources,
  UnmanagedBranchSpec,
  WorkspaceArgs,
} from "@patcher/sdk/node";
export type { CallerExecutionInputSource as ExecutionInputSource } from "@patcher/sdk/node";

export type BBSdkOptions = CreateNodePatcherSdkArgs;
export type BBSdkRealtimeSubscribeArgs = PatcherRealtimeSubscribeArgs;
export type BBSdkRealtimeSocket = PatcherRealtimeSocket;
export type BBSdkRealtimeSocketFactory = PatcherRealtimeSocketFactory;
export type BBSdkRealtimeSocketMessageEvent = PatcherRealtimeSocketMessageEvent;
export type BBSdkStatusArea = PatcherSdk["status"];
export type BBSdkSkillsArea = PatcherSdk["skills"];
export type BBSdkTerminalsArea = PatcherSdk["terminals"];
export type BBSdkThread = ThreadGetResult;
export type BBSdkThreadsArea = PatcherSdk["threads"];
export type ThreadIdArgs = ThreadStatusArgs;
export type PatcherHttpErrorConstructor = typeof PatcherHttpError;
export type PatcherRequestTimeoutErrorConstructor =
  typeof PatcherRequestTimeoutError;
export type ThreadWaitTimeoutErrorConstructor = typeof ThreadWaitTimeoutError;
export type ThreadWaitUnreachableErrorConstructor =
  typeof ThreadWaitUnreachableError;

/**
 * Public npm façade over the canonical BB SDK. Keep every area typed from
 * `@patcher/sdk` so the packaged SDK cannot drift behind the CLI or web app.
 */
export class BBSdk implements PatcherSdk {
  readonly browserHistory: PatcherSdk["browserHistory"];
  readonly environments: PatcherSdk["environments"];
  readonly files: PatcherSdk["files"];
  readonly guide: PatcherSdk["guide"];
  readonly hosts: PatcherSdk["hosts"];
  readonly plugins: PatcherSdk["plugins"];
  readonly projects: PatcherSdk["projects"];
  readonly providers: PatcherSdk["providers"];
  readonly skills: PatcherSdk["skills"];
  readonly status: PatcherSdk["status"];
  readonly system: PatcherSdk["system"];
  readonly terminals: PatcherSdk["terminals"];
  readonly theme: PatcherSdk["theme"];
  readonly threadSections: PatcherSdk["threadSections"];
  readonly threads: PatcherSdk["threads"];
  readonly subscribe: PatcherSdk["subscribe"];

  constructor(options: BBSdkOptions = {}) {
    const sdk = createNodePatcherSdk(options);
    this.browserHistory = sdk.browserHistory;
    this.environments = sdk.environments;
    this.files = sdk.files;
    this.guide = sdk.guide;
    this.hosts = sdk.hosts;
    this.plugins = sdk.plugins;
    this.projects = sdk.projects;
    this.providers = sdk.providers;
    this.skills = sdk.skills;
    this.status = sdk.status;
    this.system = sdk.system;
    this.terminals = sdk.terminals;
    this.theme = sdk.theme;
    this.threadSections = sdk.threadSections;
    this.threads = sdk.threads;
    this.subscribe = sdk.subscribe;
  }
}

export function createBBSdk(options: BBSdkOptions = {}): BBSdk {
  return new BBSdk(options);
}
