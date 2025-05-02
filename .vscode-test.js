// https://code.visualstudio.com/api/working-with-extensions/testing-extension
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  files: 'out/test/**/*.test.js',
  // --disable-gpu prevents the following error
  // ERROR:gl_display.cc(497)] EGL Driver message (Error) eglQueryDeviceAttribEXT: Bad attribute.
  launchArgs: ['--disable-gpu'],
});
