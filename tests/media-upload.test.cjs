const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {createHash}=require('node:crypto');
function fixture({denied=false,attachFails=false}={}) {
 const calls=[],removed=[];let sealed;
 const media={MAX_VIDEO_BYTES:25*1024*1024,MAX_IMAGE_BYTES:10*1024*1024,
  inspectImage:async(bytes,ext)=>{calls.push({inspect:'image',ext});return {media_type:'image',metadata_source:'server_image',width:32,height:24,aspect:'32:24'};},
  inspectVideo:async(bytes,ext)=>{calls.push({inspect:'video',ext});return {duration_s:17,width:1280,height:720,metadata_source:'server_ffprobe'};},
  storeVideo:async(bytes,orgId,ext)=>{calls.push({store:true,orgId,ext});return {storage_path:`media/${orgId}/fixture.${ext}`,mime:ext==='png'?'image/png':'video/mp4',bytes:bytes.length};},
  sealMedia:(asset,purpose)=>{sealed={asset,purpose};return 'signed-test-proof';},removeVideo:async p=>removed.push(p)};
 const api={handle:async(method,route,query,body)=>{calls.push({method,route,body});return method==='GET'?{status:denied?404:200,body:denied?{error:'not found'}:{org_id:'org-a'}}:{status:attachFails?400:201,body:attachFails?{error:'invalid creative'}:{asset:sealed.asset}};}};
 const code=ts.transpileModule(readFileSync(path.join(__dirname,'../app/api/assets/upload/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const mod={exports:{}};new Function('require','module','exports',code)(name=>name==='@/lib/api'?api:name==='@/lib/media'?media:require(name),mod,mod.exports);
 const request=(type='image/png',bytes=Buffer.from('test image'),auth=true)=>{const form=new FormData();form.append('file',new File([bytes],'test',{type}));form.append('creative_id','creative-a');return {headers:new Headers({'content-length':String(bytes.length+500),...(auth?{authorization:'Bearer test'}:{})}),formData:async()=>form};};
 return {post:mod.exports.POST,request,calls,removed,sealed:()=>sealed};
}
test('image upload hashes verified bytes and derives tenancy from permission lookup',async()=>{
 const f=fixture(),bytes=Buffer.from('fixture bytes');const result=await f.post(f.request('image/png',bytes));assert.equal(result.status,201);
 const proof=f.sealed();assert.equal(proof.purpose,'upload');assert.equal(proof.asset.org_id,'org-a');assert.equal(proof.asset.creative_id,'creative-a');assert.equal(proof.asset.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(proof.asset.media_type,'image');assert.equal(proof.asset.duration_s,undefined);
 assert.ok(f.calls.some(c=>c.inspect==='image'&&c.ext==='png'));assert.equal(f.calls.some(c=>c.inspect==='video'),false);
});
test('unauthorised and wrong-tenant uploads never inspect or persist media',async()=>{
 const anonymous=fixture();assert.equal((await anonymous.post(anonymous.request('image/png',undefined,false))).status,401);assert.equal(anonymous.calls.length,0);
 const denied=fixture({denied:true});assert.equal((await denied.post(denied.request())).status,404);assert.equal(denied.calls.some(c=>c.store||c.inspect),false);
});
test('unsupported type and large image rejected; failed attachment removes stored file',async()=>{
 const invalid=fixture();assert.equal((await invalid.post(invalid.request('image/gif'))).status,400);assert.equal(invalid.calls.some(c=>c.store),false);
 const inherited=fixture();assert.equal((await inherited.post(inherited.request('constructor'))).status,400);assert.equal(inherited.calls.some(c=>c.inspect),false);
 const big=fixture();assert.equal((await big.post(big.request('image/png',Buffer.alloc(10*1024*1024+1)))).status,413);assert.equal(big.calls.some(c=>c.inspect),false);
 const failed=fixture({attachFails:true});assert.equal((await failed.post(failed.request())).status,400);assert.deepEqual(failed.removed,['media/org-a/fixture.png']);
});
