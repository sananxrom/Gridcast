const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const mod = {exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/player-vision.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod,mod.exports);
const {frameSize,cameraConstraints,cameraError}=mod.exports;
test('capture bounds preserve aspect ratio and never upscale input',()=>{
 assert.deepEqual(frameSize(1920,1080,'640x480'),[640,360]);
 assert.deepEqual(frameSize(1080,1920,'640x480'),[270,480]);
 assert.deepEqual(frameSize(320,240,'1280x720'),[320,240]);
 assert.deepEqual(frameSize(1920,1080,'bad-value'),[640,360]);
});
test('capture uses configured camera without silently selecting a different source',()=>{
 const c=cameraConstraints({camera_device_id:'selected-device',inference_res:'320x240'});
 assert.equal(c.audio,false);assert.deepEqual(c.video.deviceId,{exact:'selected-device'});
 assert.equal(c.video.width.ideal,320);assert.equal(c.video.height.ideal,240);assert.equal(c.video.frameRate.ideal,15);
 assert.equal(cameraConstraints({}).video.deviceId,undefined);
});
test('startup distinguishes permission, missing/busy camera and model download failures',()=>{
 assert.match(cameraError({name:'NotAllowedError'},'camera'),/permission blocked/);
 assert.match(cameraError({name:'NotFoundError'},'camera'),/No camera/);
 assert.match(cameraError({name:'NotReadableError'},'camera'),/busy/);
 assert.match(cameraError({name:'OverconstrainedError'},'camera'),/configured camera/);
 assert.match(cameraError(Error('private transport details'),'model'),/detector could not load/);
});
