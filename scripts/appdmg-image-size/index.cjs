/**
 * appdmg 0.6.6, which Forge's DMG maker runs, sizes the install window from its background with
 * `require("image-size")(path, callback)`: the image-size 0.7 API. Every image-size before 2.0.3
 * is vulnerable and image-size 2 measures files only by promise, so package.json overrides
 * appdmg's image-size with this adapter. It never ships: scripts/ is outside the app bundle.
 */
const { imageSizeFromFile } = require("image-size-v2/fromFile");

/** Size the image at file and answer callback(error) or callback(null, { width, height, type }) once. */
function sizeOf(file, callback) {
  if (typeof callback !== "function") throw new TypeError("sizeOf(path, callback) needs a callback");
  // process.nextTick lets a throwing callback surface as 0.7's fs callbacks did, not as a rejection.
  imageSizeFromFile(file).then(
    (size) => process.nextTick(callback, null, size),
    (error) => process.nextTick(callback, error),
  );
}

module.exports = sizeOf;
