export interface EngineConvertRequest {
  type: 'convert';
  id: number;
  pdf: ArrayBuffer;
  assetBase: string;
  pageIndexes?: number[];
}

export interface EngineReadyMessage {
  type: 'ready';
}

export interface EngineStatusMessage {
  type: 'status';
  id: number;
  stage: 'loading' | 'converting' | 'packaging';
}

export interface EngineResultMessage {
  type: 'result';
  id: number;
  docx: ArrayBuffer;
}

export interface EngineErrorMessage {
  type: 'error';
  id: number;
  message: string;
}

export interface EngineFatalMessage {
  type: 'fatal';
  message: string;
}

export type EngineToParent =
  | EngineReadyMessage
  | EngineStatusMessage
  | EngineResultMessage
  | EngineErrorMessage
  | EngineFatalMessage;

export type EngineToWorker = EngineConvertRequest;

export type WorkerToEngine =
  | EngineStatusMessage
  | EngineResultMessage
  | EngineErrorMessage;
