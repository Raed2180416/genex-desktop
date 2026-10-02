/** Basis's trusted Emscripten bindings require dynamic JS creation. Keep that inside a
 * packaged dedicated worker, never relax the desktop renderer's no-eval CSP for asset bytes. */
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
Object.assign(self, {
  BASIS: self.BASIS,
  _EngineFormat: KTX2Loader.EngineFormat,
  _EngineType: KTX2Loader.EngineType,
  _TranscoderFormat: KTX2Loader.TranscoderFormat,
  _BasisFormat: KTX2Loader.BasisFormat,
});
KTX2Loader.BasisWorker();
