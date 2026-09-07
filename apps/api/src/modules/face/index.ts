export { analyzeFaces, embedPrimaryFace, encodingSummary, type FaceAnalysis } from './detector';
export {
  DETECTOR_ID,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  getActiveBackend,
  loadFaceModels,
  missingModelFiles,
  warmUpFaceModels,
} from './models';
export {
  dropEmbeddings,
  embeddingStoreSize,
  getEmbeddings,
  getPrimaryEmbedding,
  putEmbeddings,
  sweepEmbeddings,
} from './embedding-store';
